# AGENTS.md

Project-level instructions for AI agents working in this repository.
CLAUDE.md is a symlink to this file.

## Project Overview

TypeScript/Node.js CLI tool and framework for defining, developing, and shipping AI agent skills. Uses pnpm, targets ES2022/NodeNext. Includes WebUI and HTTP service interfaces.

## Key Commands

```bash
pnpm install           # install dependencies
pnpm build             # compile TypeScript + copy webui assets
pnpm test              # unit tests with coverage (vitest)
pnpm run lint          # eslint
pnpm run quality       # lint + duplicate check + test
pre-commit run --all-files  # all quality gates
```

## Port Allocation (prefix × 1000 + suffix)

All services use a **prefix/suffix** port scheme defined in `src/cli/serve/worktree-port.ts`:

```
Port = prefix × 1000 + suffix

suffix (last 3 digits): stable service identity
  000 = serve / dev (CLI main service + all config-only demos)
  005 = demo/personalized-recommend (standalone server)
  006 = demo/observability-demo (standalone server)
  … new standalone demos increment from 007

Config-only demos (code-formatter, financial-plugin, data-analyst-e2b) run
through `agent-bundle dev` and share suffix 0. Only standalone servers that
call `resolveServicePort(suffix)` directly in their own `main.ts` need a
dedicated suffix.

prefix: worktree isolation
  3      = main repo (ports 3000–3999, backward-compatible)
  10–63  = worktrees (hash-based, ports 10000–63999)
```

### Port Priority

1. `--port` CLI flag → used directly.
2. `PORT` environment variable → used directly (checked inside `resolveServicePort`).
3. Auto-computed `prefix × 1000 + suffix`; collision rotates prefix (never suffix).

### For Agents: Adding a New Demo

1. Pick the next available suffix (currently **7** — only needed for standalone servers that call `resolveServicePort` directly).
2. Call `resolveServicePort(<suffix>)` in your `main.ts`.
3. Update the suffix table above.
4. **Never hardcode a port number** in new server code.

### Key Files

| File | Role |
|------|------|
| `src/cli/serve/worktree-port.ts` | Core: `resolveServicePort()`, worktree detection, FNV-1a hash |
| `src/cli/serve/init.ts` | Shared serve/dev init + `DEFAULT_SERVE_PORT` |
| `src/cli/serve/serve.ts` | API-only `serve` command implementation |
| `src/cli/serve/dev.ts` | WebUI-enabled `dev` command implementation |
| `src/cli/deploy/deploy.ts` | AWS ECS Fargate deploy command |
| `src/cli/index.ts` | CLI entry, subcommand definitions and argument parsing |
| `scripts/setup-worktree-hooks.sh` | Optional post-checkout hook installer |

## Serve vs Dev

- `agent-bundle serve` starts the production API server only (`/health`, `/v1/responses`, optional `/commands`).
- `agent-bundle dev` starts the development server (API + WebUI + WebSocket + file browser).

## Architecture Boundaries

- `src/cli/` — CLI commands (build / deploy / generate / serve / dev).
- `src/agent/` — Agent interface and lifecycle.
- `src/agent-loop/` — Agent loop abstraction and pi-mono implementation.
- `src/commands/` — Command discovery and loading.
- `src/mcp/` — MCP client management and sandbox transport.
- `src/observability/` — OpenTelemetry tracing and metrics.
- `src/plugins/` — Plugin loading, parsing, and merging.
- `src/sandbox/` — Sandbox abstraction (E2B, Kubernetes providers). Docker is used only as a build tool for sandbox images.
- `src/schema/` — Bundle config schema (Zod).
- `src/service/` — HTTP service abstraction (Hono).
- `src/skills/` — Skill loading and summaries.
- `src/test-helpers/` — Shared test utilities.
- `src/webui/` — WebUI (Hono + static assets + WebSocket). Frontend uses relative URLs — no hardcoded ports.
- `demo/` — Standalone demo servers; not part of the main package.

## Quality Gates

Pre-commit hooks enforce: max file lines (850), max function lines (90), duplicate detection, eslint, test coverage, directory size limits (15 files per dir under `src/`). Additional Python linting hooks may apply to helper scripts if present. Do not disable or weaken these gates.

## Conventions

- Conventional Commits for commit messages.
- Keep PRs focused and rebase on `main` before merge.
- Tests are required for new functionality (vitest).
- ESM-only (`"type": "module"`), `.js` extensions in imports.
