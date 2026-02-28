# Observability Integration Guide

agent-bundle ships a vendor-neutral observability layer built on the
[OpenTelemetry API](https://opentelemetry.io/docs/languages/js/).
The core package depends only on `@opentelemetry/api` (~50 kB); you bring
your own SDK and exporters. When no SDK is registered every operation is a
zero-cost no-op.

## Quick Start

### 1. Install the OpenTelemetry SDK and an exporter

```bash
# Prometheus metrics
pnpm add @opentelemetry/sdk-metrics @opentelemetry/exporter-prometheus

# OTLP traces (works with Jaeger, Tempo, Datadog, Elastic APM, etc.)
pnpm add @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

### 2. Initialise at app startup

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PrometheusExporter({ port: 9464 }),
});
sdk.start();
```

### 3. Create the provider and pass it to agent-bundle

```ts
import { createObservabilityProvider } from "agent-bundle/observability";
import { createServer } from "agent-bundle/service";

const observability = createObservabilityProvider();

// HTTP server — adds request metrics + trace spans
const app = createServer(agent, { observability });

// Agent dependencies — adds lifecycle, tool-call, and MCP instrumentation
const deps: AgentDependencies = {
  // ...other fields
  observability,
};
```

That is all you need. Metrics are now exposed on `:9464/metrics` and traces
are forwarded to your OTLP collector.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Your application                                │
│                                                  │
│  ┌─────────────────┐   ┌──────────────────────┐  │
│  │ OTEL SDK +       │   │ agent-bundle core     │  │
│  │ Exporters        │   │ (@opentelemetry/api)  │  │
│  │ (user-provided)  │◄──┤                       │  │
│  └────────┬─────────┘   └───────────────────────┘  │
│           │                                        │
│           ▼                                        │
│  Prometheus / Jaeger / Datadog / ...               │
└──────────────────────────────────────────────────┘
```

agent-bundle only calls the `@opentelemetry/api` interfaces (`Tracer`,
`Meter`). It never imports an SDK or exporter. This keeps the dependency
footprint minimal and lets you swap backends without changing library code.

## Available Instrumentation

| Layer | What is measured | Metrics | Trace spans |
|-------|-----------------|---------|-------------|
| HTTP | Request duration, active requests | Yes | Yes |
| Agent lifecycle | Respond duration, active responds, token usage | Yes | No |
| Tool calls | Call duration, errors | Yes | Yes |
| MCP calls | Call duration, errors | Yes | Yes |

## Metrics Reference

All instruments are created lazily the first time they are needed.

### HTTP layer (`createHttpMetrics`)

| Metric name | Type | Unit | Attributes |
|-------------|------|------|------------|
| `http.server.request.duration` | Histogram | ms | `http.request.method`, `http.response.status_code`, `http.route` |
| `http.server.active_requests` | UpDownCounter | {request} | `http.request.method` |

### Agent lifecycle (`createAgentMetrics`)

| Metric name | Type | Unit | Attributes |
|-------------|------|------|------------|
| `agent.respond.duration` | Histogram | ms | `agent.name`, `agent.status` |
| `agent.respond.active` | UpDownCounter | {request} | `agent.name` |

### Tool calls (`createToolMetrics`)

| Metric name | Type | Unit | Attributes |
|-------------|------|------|------------|
| `agent.tool_call.duration` | Histogram | ms | `agent.tool.name`, `agent.tool.error` |
| `agent.tool_call.errors` | Counter | {error} | `agent.tool.name` |

### GenAI token usage (`createGenAiMetrics`)

| Metric name | Type | Unit | Attributes |
|-------------|------|------|------------|
| `gen_ai.usage.input_tokens` | Counter | {token} | `agent.name` |
| `gen_ai.usage.output_tokens` | Counter | {token} | `agent.name` |

### MCP calls (`createMcpMetrics`)

| Metric name | Type | Unit | Attributes |
|-------------|------|------|------------|
| `mcp.tool_call.duration` | Histogram | ms | `mcp.server.name`, `mcp.tool.name`, `mcp.tool.error` |
| `mcp.tool_call.errors` | Counter | {error} | `mcp.server.name`, `mcp.tool.name` |

## Trace Spans Reference

| Span name | Created by | Attributes |
|-----------|------------|------------|
| `HTTP <method>` | `observabilityMiddleware` | `http.request.method`, `url.path`, `http.response.status_code`, `http.route` |
| `tool <name>` | `createToolCallInstrumenter` | `agent.tool.name` |
| `mcp <server>/<tool>` | `createMcpCallInstrumenter` | `mcp.server.name`, `mcp.tool.name` |

## Semantic Attribute Constants

The module exports four constant objects for use in your own instrumentation:

```ts
import {
  HttpAttributes,   // METHOD, STATUS_CODE, ROUTE, URL_PATH
  AgentAttributes,  // AGENT_NAME, AGENT_STATUS, TOOL_NAME, TOOL_ERROR
  GenAiAttributes,  // INPUT_TOKENS, OUTPUT_TOKENS, MODEL, PROVIDER
  McpAttributes,    // SERVER_NAME, TOOL_NAME, TOOL_ERROR
} from "agent-bundle/observability";
```

The values match the OTEL semantic conventions shown in the metrics and spans
tables above (e.g. `HttpAttributes.METHOD` = `"http.request.method"`).

## Integration Examples

### Prometheus + Grafana

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { createObservabilityProvider } from "agent-bundle/observability";
import { createServer } from "agent-bundle/service";

const sdk = new NodeSDK({
  metricReader: new PrometheusExporter({ port: 9464 }),
});
sdk.start();

const observability = createObservabilityProvider();
const app = createServer(agent, { observability });
```

Point Grafana at `http://localhost:9464/metrics`. All metrics listed above
appear with their full names (e.g. `http_server_request_duration`).

### OTLP (Jaeger, Tempo, Datadog, Elastic APM)

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { createObservabilityProvider } from "agent-bundle/observability";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: "http://localhost:4318/v1/metrics",
    }),
  }),
});
sdk.start();

const observability = createObservabilityProvider();
```

### Custom / partial override

`createObservabilityProvider` accepts partial overrides if you want to supply
your own `Tracer` or `Meter` instead of the global instances:

```ts
import { trace, metrics } from "@opentelemetry/api";
import { createObservabilityProvider } from "agent-bundle/observability";

const observability = createObservabilityProvider({
  tracer: trace.getTracer("my-app", "1.0.0"),
  meter: metrics.getMeter("my-app", "1.0.0"),
});
```

## Configuration via Dependency Injection

Observability is wired through two optional fields:

### `CreateServerOptions.observability`

Applies the HTTP middleware to every route. Defined in
`src/service/create-server.ts`:

```ts
import { createServer, type CreateServerOptions } from "agent-bundle/service";

const options: CreateServerOptions = {
  observability: createObservabilityProvider(),
};
const app = createServer(agent, options);
```

### `AgentDependencies.observability`

Provides the provider to agent lifecycle hooks, tool-call instrumentation,
and MCP instrumentation. Defined in `src/agent/dependencies.ts`:

```ts
import type { AgentDependencies } from "agent-bundle/dependencies";

const deps: AgentDependencies = {
  createSandbox,
  createLoop: () => new PiMonoAgentLoop(),
  createMcpClientManager: defaultCreateMcpClientManager,
  observability: createObservabilityProvider(),
};
```

## Hook APIs

If you need programmatic access to the instrumentation hooks:

```ts
import {
  createAgentHooks,
  createToolCallInstrumenter,
  createMcpCallInstrumenter,
} from "agent-bundle/observability";

const hooks = createAgentHooks(observability, "my-agent");
const startMs = hooks.onRespondStart();
// ...after respond completes:
hooks.onRespondEnd(startMs);
hooks.onTokenUsage({ inputTokens: 150, outputTokens: 42, totalTokens: 192 });

const instrumentToolCall = createToolCallInstrumenter(observability);
const result = await instrumentToolCall(call, (c) => executeToolCall(c));

const instrumentMcpCall = createMcpCallInstrumenter(observability);
const result = await instrumentMcpCall("server", "tool", () => execute());
```

## No-op Behaviour

When no OpenTelemetry SDK is registered (the default), all operations resolve
to the OTEL built-in no-ops. This means:

- Zero overhead: no allocations, no syscalls, no timers.
- No runtime errors: every API call succeeds silently.
- No configuration needed: just skip the SDK setup.

You can safely pass `createObservabilityProvider()` everywhere even in
environments where you do not want telemetry. The provider is always valid;
it simply does nothing until an SDK is registered.

## Exported API Summary

Everything below is available from `agent-bundle/observability`:

**Types:** `ObservabilityProvider`

**Provider:** `createObservabilityProvider(override?)`

**Middleware & hooks:** `observabilityMiddleware`, `createAgentHooks`,
`createToolCallInstrumenter`, `createMcpCallInstrumenter`

**Tracing utilities:** `withSpan`, `recordSpanError`

**Attribute constants:** `HttpAttributes`, `AgentAttributes`,
`GenAiAttributes`, `McpAttributes`

**Metric factories:** `createHttpMetrics`, `createAgentMetrics`,
`createToolMetrics`, `createGenAiMetrics`, `createMcpMetrics`
