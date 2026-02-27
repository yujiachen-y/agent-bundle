# Observability Demo

Demonstrates OpenTelemetry integration with agent-bundle. The server
initializes an OTEL SDK with console exporters, creates an observability
provider, and passes it to `createServer` so every HTTP request, agent
respond, and tool call is automatically instrumented.

## Prerequisites

- Node.js >= 20 and pnpm
- `OPENAI_API_KEY`

## Quick start

```bash
OPENAI_API_KEY=... pnpm demo:observability
```

The setup script builds and generates the bundle, then starts the demo
server on `resolveServicePort(6)` (`http://localhost:3006` on main repo).

Trace spans and metric snapshots are printed to stdout every 15 seconds.

## API endpoints

- `GET /health` — returns `{ status: "ok", observability: true }`
- `/agent/*` — standard `createServer(agent)` routes (`/agent/health`,
  `/agent/v1/responses`)

## Switching to Prometheus or OTLP

The demo uses console exporters for zero-dependency setup. Swap them for
production backends as shown in `docs/observability.md`:

```ts
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";

const sdk = new NodeSDK({
  metricReader: new PrometheusExporter({ port: 9464 }),
});
```

Then point Grafana at `http://localhost:9464/metrics`.
