import type { Counter, Histogram, Meter, UpDownCounter } from "@opentelemetry/api";

/** Lazily-created instruments for the HTTP server layer. */
export type HttpMetrics = {
  requestDuration: Histogram;
  activeRequests: UpDownCounter;
};

/** Lazily-created instruments for agent lifecycle. */
export type AgentMetrics = {
  respondDuration: Histogram;
  respondActive: UpDownCounter;
};

/** Lazily-created instruments for tool calls. */
export type ToolMetrics = {
  callDuration: Histogram;
  callErrors: Counter;
};

/** Lazily-created instruments for GenAI token usage. */
export type GenAiMetrics = {
  inputTokens: Counter;
  outputTokens: Counter;
};

/** Lazily-created instruments for MCP tool calls. */
export type McpMetrics = {
  callDuration: Histogram;
  callErrors: Counter;
};

export function createHttpMetrics(meter: Meter): HttpMetrics {
  return {
    requestDuration: meter.createHistogram("http.server.request.duration", {
      description: "HTTP request latency",
      unit: "ms",
    }),
    activeRequests: meter.createUpDownCounter("http.server.active_requests", {
      description: "Number of in-flight HTTP requests",
      unit: "{request}",
    }),
  };
}

export function createAgentMetrics(meter: Meter): AgentMetrics {
  return {
    respondDuration: meter.createHistogram("agent.respond.duration", {
      description: "End-to-end agent respond time",
      unit: "ms",
    }),
    respondActive: meter.createUpDownCounter("agent.respond.active", {
      description: "Number of active respond calls",
      unit: "{request}",
    }),
  };
}

export function createToolMetrics(meter: Meter): ToolMetrics {
  return {
    callDuration: meter.createHistogram("agent.tool_call.duration", {
      description: "Tool call execution time",
      unit: "ms",
    }),
    callErrors: meter.createCounter("agent.tool_call.errors", {
      description: "Number of failed tool calls",
      unit: "{error}",
    }),
  };
}

export function createGenAiMetrics(meter: Meter): GenAiMetrics {
  return {
    inputTokens: meter.createCounter("gen_ai.usage.input_tokens", {
      description: "Input tokens consumed",
      unit: "{token}",
    }),
    outputTokens: meter.createCounter("gen_ai.usage.output_tokens", {
      description: "Output tokens consumed",
      unit: "{token}",
    }),
  };
}

export function createMcpMetrics(meter: Meter): McpMetrics {
  return {
    callDuration: meter.createHistogram("mcp.tool_call.duration", {
      description: "MCP tool call latency",
      unit: "ms",
    }),
    callErrors: meter.createCounter("mcp.tool_call.errors", {
      description: "Number of failed MCP tool calls",
      unit: "{error}",
    }),
  };
}
