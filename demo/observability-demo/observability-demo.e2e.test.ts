/**
 * E2e test for the observability demo.
 *
 * Uses a real PiMonoAgentLoop with OpenAI to validate that the full
 * observability pipeline (HTTP middleware + agent hooks + tool spans)
 * produces the expected OTEL spans and metrics against a live model.
 *
 * Requires: OPENAI_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN for anthropic)
 * Enable:   OTEL_DEMO_E2E=1
 */
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PiMonoAgentLoop, type ModelConfig, type ResponseInput } from "../../src/agent-loop/index.js";
import type { Agent, AgentStatus } from "../../src/agent/types.js";
import type { ResponseEvent, ResponseOutput } from "../../src/agent-loop/types.js";
import { createServer } from "../../src/service/create-server.js";
import { createAgentHooks } from "../../src/observability/hooks.js";
import { observabilityMiddleware } from "../../src/observability/middleware.js";
import {
  createOtelTestHarness,
  expectSpanAttribute,
  expectSpanOk,
  hasDataPoint,
  sumMetricValue,
  type OtelTestHarness,
} from "../../src/observability/otel-harness.test-util.js";
import { HttpAttributes, AgentAttributes } from "../../src/observability/types.js";

// ── env guards ───────────────────────────────────────────────────

const E2E_ENABLED = process.env.OTEL_DEMO_E2E === "1";
const hasOpenAiKey = typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0;
const anthropicToken = process.env.ANTHROPIC_OAUTH_TOKEN ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;
const hasAnthropicToken = typeof anthropicToken === "string" && anthropicToken.length > 0;
const describeIfE2E = E2E_ENABLED && (hasOpenAiKey || hasAnthropicToken) ? describe : describe.skip;

// ── helpers ──────────────────────────────────────────────────────

type EnvRestore = () => void;

function withTemporaryEnv(updates: Record<string, string | undefined>): EnvRestore {
  const prev = Object.fromEntries(
    Object.keys(updates).map((k) => [k, process.env[k]]),
  );
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; }
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; }
    }
  };
}

function resolveModel(): { config: ModelConfig; env: Record<string, string | undefined> } {
  if (hasOpenAiKey) {
    return {
      config: { provider: "openai", model: process.env.OTEL_DEMO_MODEL ?? "gpt-5.3-codex" },
      env: {},
    };
  }
  if (hasAnthropicToken && anthropicToken) {
    return {
      config: { provider: "anthropic", model: process.env.OTEL_DEMO_MODEL ?? "claude-sonnet-4-5" },
      env: { ANTHROPIC_OAUTH_TOKEN: anthropicToken },
    };
  }
  throw new Error("No LLM API key available.");
}

/**
 * Lightweight Agent implementation around PiMonoAgentLoop with
 * observability hooks wired in so the test can verify metrics.
 */
class OtelDemoAgent implements Agent {
  public readonly name = "otel-demo-agent";
  private statusValue: AgentStatus = "stopped";
  private readonly loop = new PiMonoAgentLoop();
  private hooks: ReturnType<typeof createAgentHooks> | null = null;

  constructor(
    private readonly modelConfig: ModelConfig,
    private readonly harness: OtelTestHarness,
  ) {}

  get status(): AgentStatus { return this.statusValue; }

  async initialize(): Promise<void> {
    this.hooks = createAgentHooks(this.harness.provider, this.name);
    await this.loop.init({
      systemPrompt: "You are concise. Reply with exactly the text the user asks for, nothing more.",
      model: this.modelConfig,
      toolHandler: async (call) => {
        throw new Error(`Unexpected tool call: ${call.name}`);
      },
    });
    this.statusValue = "ready";
  }

  async respond(input: ResponseInput): Promise<ResponseOutput> {
    const startMs = this.hooks!.onRespondStart();
    let completed: ResponseOutput | null = null;
    let responseError: string | null = null;

    try {
      for await (const event of this.respondStream(input)) {
        if (event.type === "response.completed") {
          completed = event.output;
          this.hooks!.onTokenUsage(event.output.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
        }
        if (event.type === "response.error") { responseError = event.error; }
      }
    } catch (err) {
      this.hooks!.onRespondEnd(startMs, err);
      throw err;
    }

    if (responseError) {
      const err = new Error(responseError);
      this.hooks!.onRespondEnd(startMs, err);
      throw err;
    }
    if (!completed) {
      const err = new Error("No completed response.");
      this.hooks!.onRespondEnd(startMs, err);
      throw err;
    }

    this.hooks!.onRespondEnd(startMs);
    return completed;
  }

  async *respondStream(input: ResponseInput): AsyncIterable<ResponseEvent> {
    if (this.statusValue === "stopped") throw new Error("Agent stopped.");
    this.statusValue = "running";
    try {
      for await (const event of this.loop.run(input)) { yield event; }
    } finally {
      if (this.statusValue !== "stopped") this.statusValue = "ready";
    }
  }

  getConversationHistory(): ResponseInput {
    return [];
  }

  getSystemPrompt(): string {
    return "";
  }

  async shutdown(): Promise<void> {
    if (this.statusValue === "stopped") return;
    this.statusValue = "stopped";
    await this.loop.dispose();
  }
}

// ── tests ────────────────────────────────────────────────────────

describeIfE2E("observability-demo E2E (real LLM)", () => {
  let agent: OtelDemoAgent;
  let app: Hono;
  let h: OtelTestHarness;
  let restoreEnv: EnvRestore;

  beforeAll(async () => {
    const { config, env } = resolveModel();
    restoreEnv = withTemporaryEnv(env);
    h = createOtelTestHarness();
    agent = new OtelDemoAgent(config, h);
    await agent.initialize();

    app = new Hono();
    app.use("*", observabilityMiddleware(h.provider));
    app.get("/health", (c) => c.json({ status: "ok", observability: true }));
    app.route("/agent", createServer(agent, { observability: h.provider }));
  }, 60_000);

  afterAll(async () => {
    await agent?.shutdown();
    await h?.shutdown();
    restoreEnv?.();
  });

  it("GET /health produces an HTTP span with correct attributes", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const spans = h.findSpans("HTTP GET");
    expect(spans.length).toBeGreaterThanOrEqual(1);
    const span = spans[spans.length - 1]!;
    expectSpanOk(span);
    expectSpanAttribute(span, HttpAttributes.METHOD, "GET");
    expectSpanAttribute(span, HttpAttributes.STATUS_CODE, 200);
  });

  it("POST /agent/v1/responses gets a real model reply and emits HTTP span + metrics", async () => {
    const marker = `otel-e2e-${Date.now()}`;
    const res = await app.request("/agent/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: [{ role: "user", content: `Output exactly: ${marker}` }],
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { output: string };
    expect(json.output.toLowerCase()).toContain(marker);

    // HTTP span
    const httpSpans = h.findSpans("HTTP POST");
    expect(httpSpans.length).toBeGreaterThanOrEqual(1);
    const httpSpan = httpSpans[httpSpans.length - 1]!;
    expectSpanOk(httpSpan);
    expectSpanAttribute(httpSpan, HttpAttributes.STATUS_CODE, 200);

    // HTTP request duration metric
    const metrics = await h.collectMetrics();
    const httpDur = metrics.find((m) => m.descriptor.name === "http.server.request.duration");
    expect(httpDur).toBeDefined();
    expect(httpDur!.dataPoints.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("records agent respond duration and token usage metrics", async () => {
    const marker = `otel-metrics-${Date.now()}`;
    const res = await app.request("/agent/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: [{ role: "user", content: `Output exactly: ${marker}` }],
      }),
    });
    expect(res.status).toBe(200);

    const metrics = await h.collectMetrics();
    const names = metrics.map((m) => m.descriptor.name);

    expect(names).toContain("agent.respond.duration");
    expect(names).toContain("gen_ai.usage.input_tokens");
    expect(names).toContain("gen_ai.usage.output_tokens");

    const dur = metrics.find((m) => m.descriptor.name === "agent.respond.duration");
    expect(hasDataPoint(dur!, { [AgentAttributes.AGENT_NAME]: "otel-demo-agent" })).toBe(true);
    expect(hasDataPoint(dur!, { [AgentAttributes.AGENT_STATUS]: "ok" })).toBe(true);

    const inp = metrics.find((m) => m.descriptor.name === "gen_ai.usage.input_tokens");
    expect(sumMetricValue(inp!)).toBeGreaterThan(0);
  }, 120_000);

  it("accumulates spans across multiple requests", async () => {
    const spansBefore = h.findSpans("HTTP POST").length;

    const res = await app.request("/agent/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: [{ role: "user", content: "Say hello" }],
      }),
    });
    expect(res.status).toBe(200);

    const spansAfter = h.findSpans("HTTP POST").length;
    expect(spansAfter).toBeGreaterThan(spansBefore);

    // Verify cumulative token metric is still positive after multiple requests.
    const metrics = await h.collectMetrics();
    const allInpMetrics = metrics.filter((m) => m.descriptor.name === "gen_ai.usage.input_tokens");
    const latestInp = allInpMetrics[allInpMetrics.length - 1];
    expect(latestInp).toBeDefined();
    expect(sumMetricValue(latestInp!)).toBeGreaterThan(0);
  }, 120_000);
});
