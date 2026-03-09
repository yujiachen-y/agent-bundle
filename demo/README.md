# Demos

Working examples that cover the main agent-bundle workflows. Each demo is self-contained — clone the repo, `cd` into the demo directory, and run `npm run setup`.

## Prerequisites

All demos require **Node.js 20+**. Most demos also need API keys as environment variables:

| Key | Required by |
|---|---|
| `E2B_API_KEY` | All E2B-based demos |
| `OPENROUTER_API_KEY` | All demos (default model provider) |

## Overview

### Config-only agents

These demos run entirely through `agent-bundle dev` — no custom server code needed. Define a YAML config, point it at skills, and go.

| Demo | Sandbox | Description |
|---|---|---|
| [code-formatter/e2b](./code-formatter/e2b) | E2B | Formats Python code in an E2B sandbox. Simplest possible agent — one skill, one config file. |
| [code-formatter/k8s](./code-formatter/k8s) | Kubernetes | Same agent as above but running on a local k3d cluster. Shows how to swap sandbox providers without changing agent logic. Requires Docker + k3d + kubectl. |
| [data-analyst-e2b](./data-analyst-e2b) | E2B | Data analysis agent with WebUI dev mode. Ask it to create datasets, run statistics, and plot charts — all visible in the live sandbox view. |
| [pdf-to-deck](./pdf-to-deck) | E2B | Turns a PDF into a polished PPTX slide deck. Uses three [skills.sh](https://skills.sh) skills (`pdf`, `pptx`, `theme-factory`) from `anthropics/skills`. |

### Custom servers with `generate`

These demos use `agent-bundle generate` to produce a typed TypeScript client, then embed it in a custom Node.js server with their own API routes.

| Demo | What it demonstrates |
|---|---|
| [personalized-recommend](./personalized-recommend) | Recommendation API (`POST /api/events`, `GET /api/recommendations/:userId`) backed by a generated agent client + MCP filesystem server for user profile memory. |
| [observability-demo](./observability-demo) | OpenTelemetry integration — tracing and metrics wired into a custom server using the generated bundle. |

### Plugins and commands

| Demo | What it demonstrates |
|---|---|
| [financial-plugin](./financial-plugin) | Plugin marketplace integration + custom commands. Exposes a `/commands/quick-analysis` endpoint that triggers a named command on the agent. |

## Running a demo

```bash
# 1. Clone the repo
git clone https://github.com/yujiachen-y/agent-bundle.git
cd agent-bundle

# 2. Pick a demo
cd demo/code-formatter/e2b

# 3. Set API keys and run
E2B_API_KEY=... OPENROUTER_API_KEY=... npm run setup
```

Every demo's `setup.sh` handles dependency installation, sandbox template builds, and server startup. After setup completes, test with:

```bash
curl http://localhost:3000/health
```

Demos using custom servers run on different ports — check each demo's README for the exact port.

## Adding a new demo

See [AGENTS.md](../AGENTS.md) for port allocation rules and conventions. Each new demo should:

1. Be a self-contained directory with its own `package.json` and `setup.sh`
2. Include a README with prerequisites, quick start, and a smoke test `curl` command
3. Use `resolveServicePort(<suffix>)` for standalone servers (next available suffix: **7**)
