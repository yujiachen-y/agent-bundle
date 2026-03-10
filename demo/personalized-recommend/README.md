# Personalized Recommend Demo

Standalone custom-server demo that uses
[@modelcontextprotocol/server-filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)
to give the agent read/write access to user profile memory and a product catalog.

## Prerequisites

- Node.js 20+
- `E2B_API_KEY`
- `OPENROUTER_API_KEY`

## Quick Start

```bash
cd demo/personalized-recommend
npm ci
E2B_API_KEY=... OPENROUTER_API_KEY=... npm run setup
```

The setup script installs dependencies, runs `npx agent-bundle build` and
`npx agent-bundle generate`, then starts `tsx main.ts`.

## Smoke Test

```bash
curl http://localhost:3005/health
```

```bash
curl -s -X POST http://localhost:3005/api/events \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u-1","event":"likes running shoes"}'
```

```bash
curl -s http://localhost:3005/api/recommendations/u-1
```
