import type { Tracer, Meter } from "@opentelemetry/api";

/**
 * Minimal observability surface injected into agent-bundle components.
 *
 * When the user registers an OpenTelemetry SDK at startup, the tracer and meter
 * will emit real telemetry. Otherwise the OTEL API returns built-in no-ops
 * with zero measurable overhead.
 */
export type ObservabilityProvider = {
  readonly tracer: Tracer;
  readonly meter: Meter;
};

/* ------------------------------------------------------------------ */
/*  Semantic attribute constants                                       */
/* ------------------------------------------------------------------ */

/** HTTP server attributes (OTEL semantic conventions). */
export const HttpAttributes = {
  METHOD: "http.request.method",
  STATUS_CODE: "http.response.status_code",
  ROUTE: "http.route",
  URL_PATH: "url.path",
} as const;

/** Agent lifecycle attributes. */
export const AgentAttributes = {
  AGENT_NAME: "agent.name",
  AGENT_STATUS: "agent.status",
  TOOL_NAME: "agent.tool.name",
  TOOL_ERROR: "agent.tool.error",
} as const;

/** GenAI semantic conventions. */
export const GenAiAttributes = {
  INPUT_TOKENS: "gen_ai.usage.input_tokens",
  OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  MODEL: "gen_ai.request.model",
  PROVIDER: "gen_ai.system",
} as const;

/** MCP attributes. */
export const McpAttributes = {
  SERVER_NAME: "mcp.server.name",
  TOOL_NAME: "mcp.tool.name",
  TOOL_ERROR: "mcp.tool.error",
} as const;
