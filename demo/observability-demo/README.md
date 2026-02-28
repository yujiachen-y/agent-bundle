# Observability Demo

Standalone custom-server demo using OpenTelemetry + generated bundle code.

## Prerequisites

- Node.js 20+
- `OPENAI_API_KEY`

## Quick Start

```bash
cd demo/observability-demo
npm install
OPENAI_API_KEY=... npm run setup
```

The setup script installs dependencies, runs `agent-bundle build`, runs
`agent-bundle generate`, then starts `tsx main.ts`.

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
