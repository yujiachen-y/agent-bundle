# Observability Demo

Standalone custom-server demo using OpenTelemetry + generated bundle code.

## Prerequisites

- Node.js 20+
- `OPENROUTER_API_KEY`

## Quick Start

```bash
cd demo/observability-demo
npm ci
OPENROUTER_API_KEY=... npm run setup
```

The setup script installs dependencies, runs `npx agent-bundle build`, runs
`npx agent-bundle generate`, then starts `tsx main.ts`.

## Smoke Test

```bash
curl http://localhost:3006/health
```

```bash
curl -s http://localhost:3006/agent/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "input": [
      {
        "role": "user",
        "content": "Reply with exactly: observability demo ok"
      }
    ]
  }'
```
