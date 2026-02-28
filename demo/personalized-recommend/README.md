# Personalized Recommend Demo

Standalone custom-server demo with generated bundle code and two MCP servers.

## Prerequisites

- Node.js 20+
- `E2B_API_KEY`
- `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN`

## Quick Start

```bash
cd demo/personalized-recommend
npm install
E2B_API_KEY=... ANTHROPIC_API_KEY=... npm run setup
```

The setup script installs dependencies, bundles the memory MCP server with
esbuild, runs `agent-bundle build`, runs `agent-bundle generate`, then starts
`tsx main.ts`.

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
