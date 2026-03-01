# Financial Plugin Demo

Standalone config-only demo with plugin marketplace integration, local skills,
and local commands.

## Prerequisites

- Node.js 20+
- `E2B_API_KEY`
- `OPENROUTER_API_KEY`

## Quick Start

```bash
cd demo/financial-plugin
npm ci
E2B_API_KEY=... OPENROUTER_API_KEY=... npm run setup
```

The setup script validates API access, builds the E2B template, and starts `agent-bundle dev`.

## Smoke Test

```bash
curl http://localhost:3000/health
```

```bash
curl http://localhost:3000/commands
```

```bash
curl -s -X POST http://localhost:3000/commands/quick-analysis \
  -H 'Content-Type: application/json' \
  -d '{"args":"Q4 revenue vs budget variance"}'
```
