# Financial Plugin Demo

Demonstrates plugin marketplace integration by loading finance skills from
the `anthropics/knowledge-work-plugins` repository and combining them with
local skills and commands.

This demo is **standalone** -- it does not depend on any other demo in
this repository.

## Prerequisites

- Node.js 20+
- pnpm
- E2B API key (`E2B_API_KEY`)
- Anthropic API key (`ANTHROPIC_API_KEY`)

## Quick Start

From the repository root:

```bash
E2B_API_KEY=... ANTHROPIC_API_KEY=... pnpm demo:financial-plugin
```

Or step by step:

```bash
# 1. Build the E2B template
pnpm build:demo:financial-plugin

# 2. Build the TypeScript project
pnpm build

# 3. Start the dev server
pnpm exec agent-bundle dev --config demo/financial-plugin/agent-bundle.yaml
```

## What It Shows

- **Plugin marketplace integration** -- skills and MCP servers
  are fetched from an Anthropic plugin marketplace GitHub repo at build time.
- **Mixed skill sources** -- a local `report-formatter` skill is combined
  with remote `variance-analysis` and `close-management` skills from the
  `finance` plugin.
- **Commands** -- the `quick-analysis` local command is available across
  all surfaces.
- **MCP server auto-discovery** -- HTTP MCP servers declared in the
  plugin's `.mcp.json` are automatically merged into the agent config.

## Triggering Commands

Commands can be triggered from three surfaces:

### TUI (Terminal)

Type a slash command in the interactive terminal:

```
> /quick-analysis Q4 revenue vs budget
```

### WebUI (Browser)

Open `http://localhost:3000` (or your selected `--port`) and use the command panel in the sidebar.
Click a command, enter arguments when prompted, and submit.

### Server API (HTTP)

```bash
# List available commands
curl http://localhost:3000/commands

# Trigger a command
curl -X POST http://localhost:3000/commands/quick-analysis \
  -H 'Content-Type: application/json' \
  -d '{"args": "Q4 revenue vs budget variance"}'
```
