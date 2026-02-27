# Observability Implementation Plan

## 1. Architecture

A new `src/observability/` module provides a universal abstraction layer built on
OpenTelemetry API concepts. The only runtime dependency is `@opentelemetry/api`
(lightweight, stable, ~50 kB). Users plug in their own SDK and exporters
(Prometheus, Elastic, Datadog, etc.) at deployment time; the library itself ships
no SDK bundle.

When no SDK is registered, every call resolves to the OTEL built-in no-ops,
giving zero measurable overhead in production unless the user opts in.

### Design principles

- **No-op by default** -- zero overhead when observability is unconfigured.
- **Dependency injection** -- an optional `observability` field on existing
  `*Dependencies` / `*Options` types injects the provider.
- **OTEL semantic conventions** -- HTTP spans follow `http.request.method`,
  `http.response.status_code`, `url.full`; GenAI attributes follow
  `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, etc.
- **ESM-compatible** -- manual instrumentation only; no monkey-patching.
- **Quality-gate safe** -- each file stays within eslint max-lines (320),
  max-function-lines (90), and the directory stays under 15 files.

## 2. Components

| File | Purpose | Approx. lines |
|------|---------|---------------|
| `types.ts` | Core interfaces: `ObservabilityProvider`, attribute maps | ~80 |
| `provider.ts` | Default provider backed by `@opentelemetry/api` globals | ~80 |
| `metrics.ts` | Metric instrument definitions (counters, histograms) | ~100 |
| `tracing.ts` | Span helper utilities (`withSpan`, `recordError`) | ~80 |
| `middleware.ts` | Hono HTTP middleware for request metrics + tracing | ~100 |
| `hooks.ts` | Hooks for agent lifecycle, tool calls, sandbox, MCP events | ~120 |
| `index.ts` | Public API re-exports | ~15 |

Total: 7 files (well under the 15-file directory cap).

## 3. Key interfaces

```ts
// types.ts
import type { Tracer, Meter, Span } from "@opentelemetry/api";

export type ObservabilityProvider = {
  readonly tracer: Tracer;
  readonly meter: Meter;
};
```

The provider is just a pair of OTEL primitives. When the user does not supply
one, the module falls back to `trace.getTracer()` / `metrics.getMeter()` from
the global API -- which return no-ops unless an SDK is registered.

## 4. Metrics catalogue

All instruments live in `metrics.ts` and are created lazily from the meter.

### HTTP layer

| Instrument | Type | Unit | Description |
|-----------|------|------|-------------|
| `http.server.request.duration` | Histogram | ms | Request latency |
| `http.server.active_requests` | UpDownCounter | {request} | In-flight requests |

### Agent lifecycle

| Instrument | Type | Unit | Description |
|-----------|------|------|-------------|
| `agent.respond.duration` | Histogram | ms | End-to-end respond time |
| `agent.respond.active` | UpDownCounter | {request} | Active respond calls |

### Tool calls

| Instrument | Type | Unit | Description |
|-----------|------|------|-------------|
| `agent.tool_call.duration` | Histogram | ms | Tool execution time |
| `agent.tool_call.errors` | Counter | {error} | Failed tool calls |

### GenAI / Token usage

| Instrument | Type | Unit | Description |
|-----------|------|------|-------------|
| `gen_ai.usage.input_tokens` | Counter | {token} | Input tokens consumed |
| `gen_ai.usage.output_tokens` | Counter | {token} | Output tokens consumed |

### MCP

| Instrument | Type | Unit | Description |
|-----------|------|------|-------------|
| `mcp.tool_call.duration` | Histogram | ms | MCP tool call latency |
| `mcp.tool_call.errors` | Counter | {error} | MCP tool call failures |

## 5. Integration points

### 5a. HTTP layer (`src/service/create-server.ts`)

Add an optional `observability` field to `CreateServerOptions`. If provided,
apply the Hono middleware that records request duration and active-request
count.

```ts
// create-server.ts  (3-line change)
if (options?.observability) {
  app.use("*", observabilityMiddleware(options.observability));
}
```

### 5b. Agent lifecycle (`src/agent/agent.ts`)

Add an optional `observability` field to `AgentDependencies`. The `respondStream`
and `initialize` methods call thin hook wrappers (`onRespondStart` /
`onRespondEnd`, `onInitialize`, `onShutdown`).

### 5c. Tool calls (`handleToolCall` in `AgentImpl`)

Wrap each call in a span via `instrumentToolCall(provider, call, fn)`.

### 5d. MCP (`src/mcp/client-manager.ts`)

Add optional `observability` field to `CreateMcpClientManagerOptions`.
Instrument `callTool` with span + duration histogram.

### 5e. Sandbox

Leverage the existing `SandboxHooks` pattern -- no new code in the sandbox
module itself. The user can attach observability hooks via `preMount` /
`postMount`.

## 6. Testing strategy

Each module gets a colocated `*.test.ts` file:

- `provider.test.ts` -- verifies default provider returns valid OTEL objects.
- `metrics.test.ts` -- verifies instruments are created with correct names.
- `tracing.test.ts` -- verifies `withSpan` propagates results and errors.
- `middleware.test.ts` -- verifies Hono middleware sets correct attributes.
- `hooks.test.ts` -- verifies lifecycle hooks record spans and metrics.

Tests use `@opentelemetry/api` directly (no SDK needed; the no-op behavior
is sufficient to prove correct wiring).

## 7. Rollout

1. Install `@opentelemetry/api` as a production dependency.
2. Create `src/observability/` with all files listed above.
3. Add optional `observability` fields to `CreateServerOptions` and
   `AgentDependencies`.
4. Write tests, verify `pnpm build && pnpm test` pass.
5. Update `package.json` exports for `./observability`.
