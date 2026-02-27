import { metrics } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";

import {
  createAgentMetrics,
  createGenAiMetrics,
  createHttpMetrics,
  createMcpMetrics,
  createToolMetrics,
} from "./metrics.js";

const meter = metrics.getMeter("test-metrics");

describe("createHttpMetrics", () => {
  it("creates request duration histogram and active requests counter", () => {
    const httpMetrics = createHttpMetrics(meter);

    expect(httpMetrics.requestDuration).toBeDefined();
    expect(httpMetrics.activeRequests).toBeDefined();
    // Verify they have the expected recording methods
    expect(typeof httpMetrics.requestDuration.record).toBe("function");
    expect(typeof httpMetrics.activeRequests.add).toBe("function");
  });
});

describe("createAgentMetrics", () => {
  it("creates respond duration and active counters", () => {
    const agentMetrics = createAgentMetrics(meter);

    expect(typeof agentMetrics.respondDuration.record).toBe("function");
    expect(typeof agentMetrics.respondActive.add).toBe("function");
  });
});

describe("createToolMetrics", () => {
  it("creates call duration histogram and error counter", () => {
    const toolMetrics = createToolMetrics(meter);

    expect(typeof toolMetrics.callDuration.record).toBe("function");
    expect(typeof toolMetrics.callErrors.add).toBe("function");
  });
});

describe("createGenAiMetrics", () => {
  it("creates input and output token counters", () => {
    const genAiMetrics = createGenAiMetrics(meter);

    expect(typeof genAiMetrics.inputTokens.add).toBe("function");
    expect(typeof genAiMetrics.outputTokens.add).toBe("function");
  });
});

describe("createMcpMetrics", () => {
  it("creates MCP call duration histogram and error counter", () => {
    const mcpMetrics = createMcpMetrics(meter);

    expect(typeof mcpMetrics.callDuration.record).toBe("function");
    expect(typeof mcpMetrics.callErrors.add).toBe("function");
  });
});
