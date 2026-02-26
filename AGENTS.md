# AGENTS.md

Project-level instructions for AI agents working in this repository.
CLAUDE.md is a symlink to this file.

## Project Overview

TypeScript/Node.js CLI tool and framework for defining, developing, and shipping AI agent skills. Uses pnpm, targets ES2022/NodeNext. Includes TUI, WebUI, and HTTP service interfaces.

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
  000 = serve (CLI main service)
  001 = demo/code-formatter-e2b
  002 = demo/code-formatter-k8s
  003 = demo/financial-plugin
  004 = demo/coding-assistant-ollama
  … new demos increment

prefix: worktree isolation
  3      = main repo (ports 3000–3999, backward-compatible)
  10–63  = worktrees (hash-based, ports 10000–63999)
```

### Port Priority

1. `PORT` environment variable → used directly.
2. `--port` CLI flag → used directly.
3. Auto-computed `prefix × 1000 + suffix`; collision rotates prefix (never suffix).

### For Agents: Adding a New Demo

1. Pick the next available suffix (currently **5**).
2. Call `resolveServicePort(<suffix>)` in your `main.ts`.
3. Update the suffix table above.
4. **Never hardcode a port number** in new server code.

### Key Files

| File | Role |
|------|------|
| `src/cli/serve/worktree-port.ts` | Core: `resolveServicePort()`, worktree detection, FNV-1a hash |
| `src/cli/serve/serve.ts` | `DEFAULT_SERVE_PORT` (3000), used by CLI `serve` command |
| `src/cli/index.ts` | CLI entry, `--port` flag parsing |
| `scripts/setup-worktree-hooks.sh` | Optional post-checkout hook installer |

## Architecture Boundaries

- `src/cli/` — CLI commands (build / generate / serve / config).
- `src/agent/` — Agent interface and lifecycle.
- `src/sandbox/` — Sandbox abstraction (E2B, Kubernetes, Docker providers).
- `src/webui/` — WebUI (Hono + static assets + WebSocket). Frontend uses relative URLs — no hardcoded ports.
- `src/tui/` — Terminal UI.
- `demo/` — Standalone demo servers; not part of the main package.

## Quality Gates

Pre-commit hooks enforce: max file lines (850), max function lines (90), duplicate detection, eslint, test coverage, directory size limits (15 files per dir under `src/`). Do not disable or weaken these gates.

## Conventions

- Conventional Commits for commit messages.
- Keep PRs focused and rebase on `main` before merge.
- Tests are required for new functionality (vitest).
- ESM-only (`"type": "module"`), `.js` extensions in imports.
