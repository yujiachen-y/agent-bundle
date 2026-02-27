/**
 * E2e tests: full pipeline (HTTP + agent + tool + MCP) and no-op case
 * with in-memory OTEL exporters.
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResponseEvent, ResponseInput, ResponseOutput, ToolCall } from "../agent-loop/types.js";
import type { Agent, AgentStatus } from "../agent/types.js";
import { createAgentHooks, createMcpCallInstrumenter, createToolCallInstrumenter } from "./hooks.js";
import { observabilityMiddleware } from "./middleware.js";
import { createObservabilityProvider } from "./provider.js";
import {
  createOtelTestHarness,
  expectSpanError,
  expectSpanOk,
  hasDataPoint,
  sumMetricValue,
  type OtelTestHarness,
} from "./otel-harness.test-util.js";
import { AgentAttributes, type ObservabilityProvider } from "./types.js";

function defaultOutput(): ResponseOutput {
  return { id: "r1", output: "ok", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
}

function mockAgent(respondFn?: Agent["respond"]): Agent {
  const out = defaultOutput();
  return {
    name: "pipe-agent",
    status: "ready" as AgentStatus,
    respond: respondFn ?? vi.fn<Agent["respond"]>().mockResolvedValue(out),
    respondStream: vi.fn<Agent["respondStream"]>().mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "response.created", responseId: "r1" } satisfies ResponseEvent;
        yield { type: "response.completed", output: out } satisfies ResponseEvent;
      },
    }),
    shutdown: vi.fn<Agent["shutdown"]>().mockResolvedValue(undefined),
  };
}

function buildApp(provider: ObservabilityProvider, agent: Agent): Hono {
  const app = new Hono();
  app.use("*", observabilityMiddleware(provider));
  app.post("/v1/responses", async (c) => {
    const body = (await c.req.json()) as { input: ResponseInput };
    try {
      return c.json(await agent.respond(body.input));
    } catch (err) {
      return c.json({ error: { message: String(err) } }, 500);
    }
  });
  return app;
}

function postRequest(app: Hono): Promise<Response> {
  return app.request("/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: [{ role: "user", content: "go" }] }),
  });
}

describe("observability e2e: no-op (no SDK)", () => {
  it("middleware works with default no-op provider", async () => {
    const noop = createObservabilityProvider();
    const app = new Hono();
    app.use("*", observabilityMiddleware(noop));
    app.get("/health", (c) => c.json({ status: "ok" }));
    expect((await app.request("/health")).status).toBe(200);
  });

  it("agent hooks work with no-op provider", () => {
    const hooks = createAgentHooks(createObservabilityProvider(), "noop");
    const s = hooks.onRespondStart();
    expect(() => hooks.onRespondEnd(s)).not.toThrow();
    expect(() => hooks.onTokenUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 })).not.toThrow();
  });

  it("tool instrumenter works with no-op provider", async () => {
    const inst = createToolCallInstrumenter(createObservabilityProvider());
    const call: ToolCall = { id: "tc", name: "bash", input: {} };
    const result = await inst(call, async () => ({ toolCallId: "tc", output: "ok" }));
    expect(result.output).toBe("ok");
  });

  it("MCP instrumenter works with no-op provider", async () => {
    const inst = createMcpCallInstrumenter(createObservabilityProvider());
    const result = await inst("s", "t", async () => ({ toolCallId: "m", output: "ok" }));
    expect(result.output).toBe("ok");
  });
});

describe("observability e2e: full pipeline", () => {
  let h: OtelTestHarness;
  beforeEach(() => { h = createOtelTestHarness(); });
  afterEach(async () => { await h.shutdown(); });

  it("emits all span and metric types in a single flow", async () => {
    const hooks = createAgentHooks(h.provider, "pipe");
    const instrTool = createToolCallInstrumenter(h.provider);
    const instrMcp = createMcpCallInstrumenter(h.provider);
    const agent = mockAgent(async () => {
      const startMs = hooks.onRespondStart();
      await instrTool(
        { id: "tc", name: "bash", input: { cmd: "echo" } },
        async () => ({ toolCallId: "tc", output: "hi" }),
      );
      await instrMcp("mem-srv", "recall", async () => ({ toolCallId: "mc", output: "ok" }));
      const out: ResponseOutput = {
        id: "rp", output: "done", usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
      };
      hooks.onTokenUsage(out.usage!);
      hooks.onRespondEnd(startMs);
      return out;
    });
    const app = buildApp(h.provider, agent);
    const res = await postRequest(app);
    expect(res.status).toBe(200);

    expect(h.findSpans("HTTP POST")).toHaveLength(1);
    expectSpanOk(h.findSpans("HTTP POST")[0]!);
    expect(h.findSpans("tool bash")).toHaveLength(1);
    expect(h.findSpans("mcp mem-srv/recall")).toHaveLength(1);

    const metrics = await h.collectMetrics();
    const names = metrics.map((m) => m.descriptor.name);
    for (const n of [
      "http.server.request.duration", "agent.respond.duration",
      "agent.tool_call.duration", "mcp.tool_call.duration",
      "gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens",
    ]) { expect(names).toContain(n); }
    const inp = metrics.find((m) => m.descriptor.name === "gen_ai.usage.input_tokens");
    expect(sumMetricValue(inp!)).toBe(50);
  });

  it("records errors across the full pipeline", async () => {
    const hooks = createAgentHooks(h.provider, "err-agent");
    const instrTool = createToolCallInstrumenter(h.provider);
    const agent = mockAgent(async () => {
      const startMs = hooks.onRespondStart();
      try {
        await instrTool(
          { id: "tc", name: "bad", input: {} },
          async () => { throw new Error("tool boom"); },
        );
        hooks.onRespondEnd(startMs);
        return defaultOutput();
      } catch (error) {
        hooks.onRespondEnd(startMs, error);
        throw error;
      }
    });
    const app = buildApp(h.provider, agent);
    const res = await postRequest(app);
    expect(res.status).toBe(500);

    expectSpanError(h.findSpans("tool bad")[0]!);
    const metrics = await h.collectMetrics();
    const dur = metrics.find((m) => m.descriptor.name === "agent.respond.duration");
    expect(hasDataPoint(dur!, { [AgentAttributes.AGENT_STATUS]: "error" })).toBe(true);
    const errs = metrics.find((m) => m.descriptor.name === "agent.tool_call.errors");
    expect(sumMetricValue(errs!)).toBeGreaterThanOrEqual(1);
  });
});
