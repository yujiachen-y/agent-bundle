/**
 * E2e tests: HTTP middleware, agent hooks, tool and MCP instrumentation
 * with in-memory OTEL exporters.
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResponseEvent, ResponseOutput, ToolCall, ToolResult } from "../agent-loop/types.js";
import type { Agent, AgentStatus } from "../agent/types.js";
import { createAgentHooks, createMcpCallInstrumenter, createToolCallInstrumenter } from "./hooks.js";
import { observabilityMiddleware } from "./middleware.js";
import {
  createOtelTestHarness,
  expectSpanAttribute,
  expectSpanOk,
  hasDataPoint,
  sumMetricValue,
  type OtelTestHarness,
} from "./otel-harness.test-util.js";
import { AgentAttributes, HttpAttributes, McpAttributes } from "./types.js";

function createMockAgent(): Agent {
  const output: ResponseOutput = {
    id: "resp-1",
    output: "hello",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
  return {
    name: "otel-e2e-agent",
    status: "ready" as AgentStatus,
    respond: vi.fn<Agent["respond"]>().mockResolvedValue(output),
    respondStream: vi.fn<Agent["respondStream"]>().mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "response.created", responseId: "resp-1" } satisfies ResponseEvent;
        yield { type: "response.completed", output } satisfies ResponseEvent;
      },
    }),
    clearHistory: vi.fn<Agent["clearHistory"]>().mockImplementation(() => undefined),
    shutdown: vi.fn<Agent["shutdown"]>().mockResolvedValue(undefined),
  };
}

describe("observability e2e: HTTP middleware", () => {
  let h: OtelTestHarness;
  beforeEach(() => { h = createOtelTestHarness(); });
  afterEach(async () => { await h.shutdown(); });

  function makeApp(harness: OtelTestHarness): Hono {
    const agent = createMockAgent();
    const app = new Hono();
    app.use("*", observabilityMiddleware(harness.provider));
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.post("/v1/responses", async (c) => {
      const body = (await c.req.json()) as { input: unknown };
      const out = await agent.respond([{ role: "user", content: String(body.input) }]);
      return c.json(out);
    });
    return app;
  }

  it("creates a span for GET with correct attributes", async () => {
    const app = makeApp(h);
    await app.request("/health");
    const spans = h.findSpans("HTTP GET");
    expect(spans).toHaveLength(1);
    expectSpanOk(spans[0]!);
    expectSpanAttribute(spans[0]!, HttpAttributes.METHOD, "GET");
    expectSpanAttribute(spans[0]!, HttpAttributes.STATUS_CODE, 200);
  });

  it("records HTTP request duration metric", async () => {
    const app = makeApp(h);
    await app.request("/health");
    const metrics = await h.collectMetrics();
    const dur = metrics.find((m) => m.descriptor.name === "http.server.request.duration");
    expect(dur).toBeDefined();
    expect(dur!.dataPoints.length).toBeGreaterThanOrEqual(1);
  });

  it("records POST span with 200 status", async () => {
    const app = makeApp(h);
    await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    });
    const spans = h.findSpans("HTTP POST");
    expect(spans).toHaveLength(1);
    expectSpanAttribute(spans[0]!, HttpAttributes.STATUS_CODE, 200);
  });

  it("records 500 status code when handler throws", async () => {
    const app = new Hono();
    app.use("*", observabilityMiddleware(h.provider));
    app.get("/fail", () => { throw new Error("crash"); });
    await app.request("/fail");
    const spans = h.findSpans("HTTP GET");
    expect(spans).toHaveLength(1);
    expectSpanAttribute(spans[0]!, HttpAttributes.STATUS_CODE, 500);
  });

  it("creates separate spans for multiple requests", async () => {
    const app = makeApp(h);
    await app.request("/health");
    await app.request("/health");
    await app.request("/health");
    expect(h.findSpans("HTTP GET")).toHaveLength(3);
  });
});

describe("observability e2e: agent hooks", () => {
  let h: OtelTestHarness;
  beforeEach(() => { h = createOtelTestHarness(); });
  afterEach(async () => { await h.shutdown(); });

  it("records respond duration with ok status", async () => {
    const hooks = createAgentHooks(h.provider, "test-agent");
    const startMs = hooks.onRespondStart();
    hooks.onRespondEnd(startMs);
    const metrics = await h.collectMetrics();
    const dur = metrics.find((m) => m.descriptor.name === "agent.respond.duration");
    expect(dur).toBeDefined();
    expect(hasDataPoint(dur!, { [AgentAttributes.AGENT_STATUS]: "ok" })).toBe(true);
  });

  it("records respond duration with error status", async () => {
    const hooks = createAgentHooks(h.provider, "test-agent");
    const startMs = hooks.onRespondStart();
    hooks.onRespondEnd(startMs, new Error("boom"));
    const metrics = await h.collectMetrics();
    const dur = metrics.find((m) => m.descriptor.name === "agent.respond.duration");
    expect(dur).toBeDefined();
    expect(hasDataPoint(dur!, { [AgentAttributes.AGENT_STATUS]: "error" })).toBe(true);
  });

  it("records cumulative token usage", async () => {
    const hooks = createAgentHooks(h.provider, "test-agent");
    hooks.onTokenUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    hooks.onTokenUsage({ inputTokens: 200, outputTokens: 80, totalTokens: 280 });
    const metrics = await h.collectMetrics();
    const inp = metrics.find((m) => m.descriptor.name === "gen_ai.usage.input_tokens");
    const out = metrics.find((m) => m.descriptor.name === "gen_ai.usage.output_tokens");
    expect(inp).toBeDefined();
    expect(sumMetricValue(inp!)).toBe(300);
    expect(sumMetricValue(out!)).toBe(130);
  });

  it("works without agent name", async () => {
    const hooks = createAgentHooks(h.provider);
    const startMs = hooks.onRespondStart();
    hooks.onRespondEnd(startMs);
    const metrics = await h.collectMetrics();
    const dur = metrics.find((m) => m.descriptor.name === "agent.respond.duration");
    expect(dur).toBeDefined();
  });
});

describe("observability e2e: tool call instrumentation", () => {
  let h: OtelTestHarness;
  beforeEach(() => { h = createOtelTestHarness(); });
  afterEach(async () => { await h.shutdown(); });

  it("creates span and duration metric on success", async () => {
    const inst = createToolCallInstrumenter(h.provider);
    const call: ToolCall = { id: "tc-1", name: "bash", input: { cmd: "ls" } };
    await inst(call, async () => ({ toolCallId: "tc-1", output: "files" }));
    const spans = h.findSpans("tool bash");
    expect(spans).toHaveLength(1);
    expectSpanOk(spans[0]!);
    const metrics = await h.collectMetrics();
    const dur = metrics.find((m) => m.descriptor.name === "agent.tool_call.duration");
    expect(dur).toBeDefined();
    expect(hasDataPoint(dur!, { [AgentAttributes.TOOL_NAME]: "bash" })).toBe(true);
  });

  it("records error metric when tool throws", async () => {
    const inst = createToolCallInstrumenter(h.provider);
    const call: ToolCall = { id: "tc-2", name: "fail", input: {} };
    await expect(inst(call, async () => { throw new Error("crash"); })).rejects.toThrow("crash");
    const metrics = await h.collectMetrics();
    const errs = metrics.find((m) => m.descriptor.name === "agent.tool_call.errors");
    expect(errs).toBeDefined();
    expect(sumMetricValue(errs!)).toBeGreaterThanOrEqual(1);
  });

  it("records error metric for isError results", async () => {
    const inst = createToolCallInstrumenter(h.provider);
    const call: ToolCall = { id: "tc-3", name: "read", input: {} };
    const errResult: ToolResult = { toolCallId: "tc-3", output: "not found", isError: true };
    await inst(call, async () => errResult);
    const metrics = await h.collectMetrics();
    const errs = metrics.find((m) => m.descriptor.name === "agent.tool_call.errors");
    expect(sumMetricValue(errs!)).toBeGreaterThanOrEqual(1);
  });

  it("sets error attribute to false on success", async () => {
    const inst = createToolCallInstrumenter(h.provider);
    await inst({ id: "tc-4", name: "w", input: {} }, async () => ({ toolCallId: "tc-4", output: "ok" }));
    const metrics = await h.collectMetrics();
    const dur = metrics.find((m) => m.descriptor.name === "agent.tool_call.duration");
    expect(hasDataPoint(dur!, { [AgentAttributes.TOOL_ERROR]: "false" })).toBe(true);
  });
});

describe("observability e2e: MCP call instrumentation", () => {
  let h: OtelTestHarness;
  beforeEach(() => { h = createOtelTestHarness(); });
  afterEach(async () => { await h.shutdown(); });

  it("creates span and metrics on success", async () => {
    const inst = createMcpCallInstrumenter(h.provider);
    await inst("my-srv", "search", async () => ({ toolCallId: "m1", output: "r" }));
    const spans = h.findSpans("mcp my-srv/search");
    expect(spans).toHaveLength(1);
    expectSpanOk(spans[0]!);
    expectSpanAttribute(spans[0]!, McpAttributes.SERVER_NAME, "my-srv");
    expectSpanAttribute(spans[0]!, McpAttributes.TOOL_NAME, "search");
  });

  it("records error span and metric when MCP throws", async () => {
    const inst = createMcpCallInstrumenter(h.provider);
    await expect(inst("s", "t", async () => { throw new Error("mcp crash"); })).rejects.toThrow();
    const metrics = await h.collectMetrics();
    const errs = metrics.find((m) => m.descriptor.name === "mcp.tool_call.errors");
    expect(sumMetricValue(errs!)).toBeGreaterThanOrEqual(1);
  });

  it("records error metric for isError MCP results", async () => {
    const inst = createMcpCallInstrumenter(h.provider);
    await inst("s", "t", async () => ({ toolCallId: "m2", output: "err", isError: true }));
    const metrics = await h.collectMetrics();
    const errs = metrics.find((m) => m.descriptor.name === "mcp.tool_call.errors");
    expect(sumMetricValue(errs!)).toBeGreaterThanOrEqual(1);
  });
});
