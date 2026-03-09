import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PiMonoAgentLoop, type ModelConfig, type ResponseInput } from "../agent-loop/index.js";
import type { Agent, AgentStatus } from "../agent/types.js";
import { createServer } from "./create-server.js";

const E2E_ENABLED = process.env.SERVICE_E2E === "1";
const hasOpenAiKey = typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0;
const anthropicToken = process.env.ANTHROPIC_OAUTH_TOKEN ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;
const hasAnthropicToken = typeof anthropicToken === "string" && anthropicToken.length > 0;
const describeIfE2E = E2E_ENABLED && (hasOpenAiKey || hasAnthropicToken) ? describe : describe.skip;

type EnvRestore = () => void;

type ProviderModel = {
  modelConfig: ModelConfig;
  env: Record<string, string | undefined>;
};

type SseEvent = {
  type: string;
} & Record<string, unknown>;

class PiMonoLoopAgent implements Agent {
  public readonly name = "service-e2e-agent";
  private statusValue: AgentStatus = "stopped";
  private readonly loop = new PiMonoAgentLoop();

  public constructor(private readonly modelConfig: ModelConfig) {}

  public get status(): AgentStatus {
    return this.statusValue;
  }

  public async initialize(): Promise<void> {
    await this.loop.init({
      systemPrompt: "You are concise. Follow the user's instruction exactly and do not use tools.",
      model: this.modelConfig,
      toolHandler: async (call) => {
        throw new Error(`Unexpected tool call in service e2e: ${call.name}`);
      },
    });
    this.statusValue = "ready";
  }

  public async respond(input: ResponseInput) {
    let completedOutput: { id: string; output: string; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } } | null = null;
    let responseError: string | null = null;

    for await (const event of this.respondStream(input)) {
      if (event.type === "response.completed") {
        completedOutput = event.output;
      }

      if (event.type === "response.error") {
        responseError = event.error;
      }
    }

    if (responseError) {
      throw new Error(responseError);
    }

    if (!completedOutput) {
      throw new Error("Agent did not produce a completed response.");
    }

    return completedOutput;
  }

  public async *respondStream(input: ResponseInput) {
    if (this.statusValue === "stopped") {
      throw new Error("Agent is stopped.");
    }

    this.statusValue = "running";

    try {
      for await (const event of this.loop.run(input)) {
        yield event;
      }
    } finally {
      if (this.statusValue !== "stopped") {
        this.statusValue = "ready";
      }
    }
  }

  public async shutdown(): Promise<void> {
    if (this.statusValue === "stopped") {
      return;
    }

    this.statusValue = "stopped";
    await this.loop.dispose();
  }

  public getConversationHistory(): ResponseInput {
    return [];
  }

  public getSystemPrompt(): string {
    return "";
  }

  public clearHistory(): void {
    // E2E agent is stateless across requests in this test suite.
  }
}

function withTemporaryEnv(updates: Record<string, string | undefined>): EnvRestore {
  const previousValues = Object.fromEntries(
    Object.keys(updates).map((key) => [key, process.env[key]]),
  );

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });

  return () => {
    Object.entries(previousValues).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    });
  };
}

function resolveProviderModel(): ProviderModel {
  const requestedProvider = process.env.SERVICE_E2E_PROVIDER;

  if (requestedProvider === "openai" || (!requestedProvider && hasOpenAiKey)) {
    if (!hasOpenAiKey) {
      throw new Error("SERVICE_E2E_PROVIDER=openai requires OPENAI_API_KEY.");
    }

    return {
      modelConfig: {
        provider: "openai",
        model: process.env.SERVICE_E2E_OPENAI_MODEL ?? process.env.PI_MONO_E2E_OPENAI_MODEL ?? "gpt-5-mini",
      },
      env: {},
    };
  }

  if (requestedProvider === "anthropic" || (!requestedProvider && hasAnthropicToken)) {
    if (!hasAnthropicToken || !anthropicToken) {
      throw new Error("SERVICE_E2E_PROVIDER=anthropic requires ANTHROPIC_OAUTH_TOKEN or CLAUDE_CODE_OAUTH_TOKEN.");
    }

    return {
      modelConfig: {
        provider: "anthropic",
        model: process.env.SERVICE_E2E_ANTHROPIC_MODEL ?? process.env.PI_MONO_E2E_ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
      },
      env: {
        ANTHROPIC_OAUTH_TOKEN: anthropicToken,
      },
    };
  }

  throw new Error("SERVICE_E2E_PROVIDER must be openai or anthropic when provided.");
}

function createRequestInput(marker: string): ResponseInput {
  return [
    {
      role: "user",
      content: `Output exactly: ${marker}`,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSseEvent(value: unknown): value is SseEvent {
  return isRecord(value) && typeof value.type === "string";
}

function parseSseEvents(ssePayload: string): SseEvent[] {
  const frames = ssePayload.split("\n\n").filter((frame) => frame.length > 0);
  const payloads = frames.map((frame) => frame.replace(/^data:\s*/, ""));
  return payloads.map((payload) => {
    const parsed: unknown = JSON.parse(payload);
    if (!isSseEvent(parsed)) {
      throw new Error("SSE frame payload is not a valid response event object.");
    }

    return parsed;
  });
}

function readOutputText(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "output" in body &&
    typeof body.output === "string"
  ) {
    return body.output;
  }

  throw new Error("Response JSON does not include a string output field.");
}

describeIfE2E("createServer E2E", () => {
  let agent: PiMonoLoopAgent | null = null;
  let restoreEnv: EnvRestore | null = null;
  let app: ReturnType<typeof createServer> | null = null;

  beforeAll(async () => {
    const providerModel = resolveProviderModel();
    restoreEnv = withTemporaryEnv(providerModel.env);
    agent = new PiMonoLoopAgent(providerModel.modelConfig);
    await agent.initialize();
    app = createServer(agent);
  }, 120_000);

  afterAll(async () => {
    if (agent) {
      await agent.shutdown();
    }

    if (restoreEnv) {
      restoreEnv();
    }
  });

  it("returns a real model response in JSON mode", async () => {
    if (!app) {
      throw new Error("Service app is not initialized.");
    }

    const marker = `service-e2e-json-${Date.now()}`;
    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: createRequestInput(marker),
      }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(readOutputText(json).toLowerCase()).toContain(marker);
  }, 120_000);

  it("returns SSE events in streaming mode", async () => {
    if (!app) {
      throw new Error("Service app is not initialized.");
    }

    const marker = `service-e2e-stream-${Date.now()}`;
    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: createRequestInput(marker),
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const ssePayload = await response.text();
    const events = parseSseEvents(ssePayload);
    expect(events.some((event) => event.type === "response.created")).toBe(true);
    expect(events.some((event) => event.type === "response.completed")).toBe(true);
    expect(events.some((event) => event.type === "response.error")).toBe(false);

    const completed = events.find((event) => event.type === "response.completed");
    if (!completed || completed.type !== "response.completed") {
      throw new Error("Streaming response is missing response.completed event.");
    }

    expect(completed.output.output.toLowerCase()).toContain(marker);
  }, 120_000);
});
