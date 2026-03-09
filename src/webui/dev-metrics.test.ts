import { describe, expect, it, beforeEach } from "vitest";

import type { Agent, AgentStatus, RespondStreamOptions } from "../agent/types.js";
import type { ResponseEvent, ResponseInput, ResponseOutput } from "../agent-loop/types.js";
import { FakeSandbox } from "../agent/agent.test-helpers.js";
import { DevMetricsCollector } from "./dev-metrics.js";
import { wrapAgentWithDevMetrics } from "./dev-metrics-agent-wrapper.js";
import { createWebUIServer } from "./create-webui-server.js";

/* ------------------------------------------------------------------ */
/*  DevMetricsCollector unit tests                                     */
/* ------------------------------------------------------------------ */

describe("DevMetricsCollector — basics", () => {
  let collector: DevMetricsCollector;

  beforeEach(() => {
    collector = new DevMetricsCollector();
  });

  it("returns zeroed snapshot initially", () => {
    const snap = collector.snapshot();
    expect(snap.respondCount).toBe(0);
    expect(snap.respondErrorCount).toBe(0);
    expect(snap.respondActive).toBe(0);
    expect(snap.inputTokensTotal).toBe(0);
    expect(snap.outputTokensTotal).toBe(0);
    expect(snap.toolCallCount).toBe(0);
    expect(snap.mcpCallCount).toBe(0);
    expect(snap.httpRequestCount).toBe(0);
    expect(snap.respondDuration).toEqual({ count: 0, sum: 0, min: 0, max: 0, avg: 0 });
  });

  it("records respond lifecycle", () => {
    collector.recordRespondStart();
    expect(collector.snapshot().respondActive).toBe(1);
    collector.recordRespondEnd(150, false);
    const snap = collector.snapshot();
    expect(snap.respondCount).toBe(1);
    expect(snap.respondErrorCount).toBe(0);
    expect(snap.respondActive).toBe(0);
    expect(snap.respondDuration.count).toBe(1);
    expect(snap.respondDuration.sum).toBe(150);
    expect(snap.respondDuration.avg).toBe(150);
  });

  it("records respond errors", () => {
    collector.recordRespondStart();
    collector.recordRespondEnd(200, true);
    expect(collector.snapshot().respondErrorCount).toBe(1);
  });

  it("accumulates token usage", () => {
    collector.recordTokenUsage(100, 50);
    collector.recordTokenUsage(200, 100);
    const snap = collector.snapshot();
    expect(snap.inputTokensTotal).toBe(300);
    expect(snap.outputTokensTotal).toBe(150);
  });

  it("respondActive does not go below zero", () => {
    collector.recordRespondEnd(0, false);
    expect(collector.snapshot().respondActive).toBe(0);
  });

  it("snapshot returns immutable copy", () => {
    collector.recordTokenUsage(100, 50);
    const snap1 = collector.snapshot();
    collector.recordTokenUsage(200, 100);
    const snap2 = collector.snapshot();
    expect(snap1.inputTokensTotal).toBe(100);
    expect(snap2.inputTokensTotal).toBe(300);
  });
});

describe("DevMetricsCollector — breakdowns", () => {
  let collector: DevMetricsCollector;

  beforeEach(() => {
    collector = new DevMetricsCollector();
  });

  it("tracks tool calls with per-name breakdown", () => {
    collector.recordToolCall("bash", 50, false);
    collector.recordToolCall("read", 30, false);
    collector.recordToolCall("bash", 70, true);
    const snap = collector.snapshot();
    expect(snap.toolCallCount).toBe(3);
    expect(snap.toolCallErrorCount).toBe(1);
    expect(snap.toolCallsByName["bash"]).toEqual({ count: 2, errors: 1, avgDurationMs: 60 });
    expect(snap.toolCallsByName["read"]).toEqual({ count: 1, errors: 0, avgDurationMs: 30 });
  });

  it("tracks MCP calls with per-server breakdown", () => {
    collector.recordMcpCall("fs-server", 100, false);
    collector.recordMcpCall("fs-server", 200, true);
    const snap = collector.snapshot();
    expect(snap.mcpCallCount).toBe(2);
    expect(snap.mcpCallErrorCount).toBe(1);
    expect(snap.mcpCallsByServer["fs-server"]).toEqual({ count: 2, errors: 1, avgDurationMs: 150 });
  });

  it("tracks HTTP requests with per-route breakdown", () => {
    collector.recordHttpRequest("GET /api/info", 10, false);
    collector.recordHttpRequest("GET /api/info", 20, false);
    collector.recordHttpRequest("POST /v1/responses", 500, false);
    const snap = collector.snapshot();
    expect(snap.httpRequestCount).toBe(3);
    expect(snap.httpRequestsByRoute["GET /api/info"]).toEqual({ count: 2, errors: 0, avgDurationMs: 15 });
  });

  it("computes histogram min/max correctly", () => {
    collector.recordToolCall("a", 10, false);
    collector.recordToolCall("a", 50, false);
    collector.recordToolCall("a", 30, false);
    const snap = collector.snapshot();
    expect(snap.toolCallDuration.min).toBe(10);
    expect(snap.toolCallDuration.max).toBe(50);
    expect(snap.toolCallDuration.avg).toBeCloseTo(30);
  });

  it("reset clears all accumulated data", () => {
    collector.recordRespondStart();
    collector.recordRespondEnd(100, false);
    collector.recordTokenUsage(500, 200);
    collector.recordToolCall("bash", 50, false);
    collector.recordMcpCall("srv", 100, false);
    collector.recordHttpRequest("GET /", 10, false);
    collector.reset();
    const snap = collector.snapshot();
    expect(snap.respondCount).toBe(0);
    expect(snap.inputTokensTotal).toBe(0);
    expect(snap.toolCallCount).toBe(0);
    expect(snap.mcpCallCount).toBe(0);
    expect(snap.httpRequestCount).toBe(0);
    expect(Object.keys(snap.toolCallsByName)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Agent wrapper tests                                                */
/* ------------------------------------------------------------------ */

class StubAgent implements Agent {
  public readonly name = "test-agent";
  public events: ResponseEvent[] = [];

  get status(): AgentStatus {
    return "ready";
  }
  async respond(input: ResponseInput): Promise<ResponseOutput> {
    void input;
    return { id: "r1", output: "ok" };
  }
  async *respondStream(
    input: ResponseInput,
    options?: RespondStreamOptions,
  ): AsyncIterable<ResponseEvent> {
    void input;
    void options;
    for (const event of this.events) {
      yield event;
    }
  }
  getConversationHistory(): ResponseInput {
    return [];
  }
  getSystemPrompt(): string {
    return "test";
  }
  clearHistory(): void {}
  async shutdown(): Promise<void> {}
}

async function consumeStream(stream: AsyncIterable<ResponseEvent>): Promise<ResponseEvent[]> {
  const events: ResponseEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("wrapAgentWithDevMetrics", () => {
  it("delegates name and status", () => {
    const agent = new StubAgent();
    const collector = new DevMetricsCollector();
    const wrapped = wrapAgentWithDevMetrics(agent, collector);
    expect(wrapped.name).toBe("test-agent");
    expect(wrapped.status).toBe("ready");
  });

  it("records respond metrics from stream", async () => {
    const agent = new StubAgent();
    agent.events = [
      { type: "response.created", responseId: "r1" },
      {
        type: "response.completed",
        output: { id: "r1", output: "hello", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } },
      },
    ];
    const collector = new DevMetricsCollector();
    const wrapped = wrapAgentWithDevMetrics(agent, collector);
    const events = await consumeStream(wrapped.respondStream([{ role: "user", content: "hi" }]));
    expect(events).toHaveLength(2);
    const snap = collector.snapshot();
    expect(snap.respondCount).toBe(1);
    expect(snap.respondErrorCount).toBe(0);
    expect(snap.inputTokensTotal).toBe(100);
    expect(snap.outputTokensTotal).toBe(50);
  });

  it("records tool call metrics from stream events", async () => {
    const agent = new StubAgent();
    agent.events = [
      { type: "response.tool_call.created", toolCall: { id: "tc1", name: "bash", input: {} } },
      { type: "response.tool_call.done", result: { toolCallId: "tc1", output: "done", isError: false } },
      { type: "response.completed", output: { id: "r1", output: "ok" } },
    ];
    const collector = new DevMetricsCollector();
    const wrapped = wrapAgentWithDevMetrics(agent, collector);
    await consumeStream(wrapped.respondStream([{ role: "user", content: "hi" }]));
    const snap = collector.snapshot();
    expect(snap.toolCallCount).toBe(1);
    expect(snap.toolCallErrorCount).toBe(0);
  });

  it("detects errors in stream", async () => {
    const agent = new StubAgent();
    agent.events = [
      { type: "response.error", error: "something went wrong" },
    ];
    const collector = new DevMetricsCollector();
    const wrapped = wrapAgentWithDevMetrics(agent, collector);
    await consumeStream(wrapped.respondStream([{ role: "user", content: "hi" }]));
    const snap = collector.snapshot();
    expect(snap.respondCount).toBe(1);
    expect(snap.respondErrorCount).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  API endpoint tests                                                 */
/* ------------------------------------------------------------------ */

describe("Metrics API endpoints", () => {
  it("GET /api/metrics returns enabled:false when no collector", async () => {
    const agent = new StubAgent();
    const sandbox = new FakeSandbox();
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/metrics");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ enabled: false });
    shutdown();
  });

  it("GET /api/metrics returns snapshot when collector provided", async () => {
    const agent = new StubAgent();
    const sandbox = new FakeSandbox();
    const devMetrics = new DevMetricsCollector();
    devMetrics.recordTokenUsage(42, 10);
    const { app, shutdown } = createWebUIServer({ agent, sandbox, devMetrics });
    const res = await app.request("/api/metrics");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.inputTokensTotal).toBe(42);
    expect(body.outputTokensTotal).toBe(10);
    expect(body.collectorStartedAt).toBeDefined();
    shutdown();
  });

  it("POST /api/metrics/reset resets the collector", async () => {
    const agent = new StubAgent();
    const sandbox = new FakeSandbox();
    const devMetrics = new DevMetricsCollector();
    devMetrics.recordTokenUsage(100, 50);
    const { app, shutdown } = createWebUIServer({ agent, sandbox, devMetrics });
    const resetRes = await app.request("/api/metrics/reset", { method: "POST" });
    expect(resetRes.status).toBe(200);
    const res = await app.request("/api/metrics");
    const body = await res.json();
    expect(body.inputTokensTotal).toBe(0);
    shutdown();
  });

  it("POST /api/metrics/reset returns enabled:false when no collector", async () => {
    const agent = new StubAgent();
    const sandbox = new FakeSandbox();
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/metrics/reset", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ enabled: false });
    shutdown();
  });
});
