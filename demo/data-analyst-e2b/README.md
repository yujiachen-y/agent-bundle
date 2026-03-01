# Data Analyst E2B Demo

Standalone config-only demo for `agent-bundle dev` with an E2B sandbox.

## Prerequisites

- Node.js 20+
- `E2B_API_KEY`
- `OPENAI_API_KEY`

## Quick Start

```bash
cd demo/data-analyst-e2b
npm ci
E2B_API_KEY=... OPENAI_API_KEY=... npm run setup
```

The setup script validates API access, builds the E2B template, and starts `agent-bundle dev`.

## Smoke Test

```bash
curl http://localhost:3000/health
```

```bash
curl -s http://localhost:3000/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "input": [
      {
        "role": "user",
        "content": "Create a simple 12-row sales dataset and summarize mean/median."
      }
    ]
  }'
```
