# Personalized Recommend Demo

Shows a custom server integration that combines:

- generated bundle factory (`@agent-bundle/personalized-recommend`)
- two MCP servers (`memory` via stdio in-sandbox, `products` via local HTTP)
- custom API routes for events, recommendations, and memory flush

## Prerequisites

- Node.js >= 20 and pnpm
- `E2B_API_KEY`
- `ANTHROPIC_API_KEY`

## Quick start

```bash
E2B_API_KEY=... ANTHROPIC_API_KEY=... pnpm demo:personalized-recommend
```

The setup script builds and generates the bundle, then starts:

- Memory MCP server via stdio (runs inside the sandbox)
- Product MCP server on `http://127.0.0.1:3102/mcp`
- Demo API server on `resolveServicePort(5)` (`http://localhost:3005` on main repo)

## API endpoints

- `POST /api/events`
- `GET /api/recommendations/:userId`
- `POST /api/flush`
- `GET /health`
- `/agent/*` for raw `createServer(agent)` API routes
