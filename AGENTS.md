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

## Git Worktree Port Allocation

This repo is frequently developed in parallel via Git worktrees (Claude Code, Codex, etc.). To avoid port conflicts, a **deterministic port allocation** mechanism exists in `src/cli/serve/worktree-port.ts`.

### How It Works

- **Main repo**: uses port 3000 (default, unchanged).
- **Worktrees**: port is computed as `3000 + (fnv1a32(worktree_dir_name) % 99 + 1) * 10`.
- Each worktree gets a block of 10 ports (e.g. 3140–3149): main service at +0, demos at +1, +2.
- Detection: if `.git` is a file (not a directory), the process is in a worktree.

### Port Priority (highest to lowest)

1. `--port` CLI flag — explicit override, always wins.
2. `PORT` environment variable.
3. Worktree auto-detection via `resolveWorktreePort()`.
4. `DEFAULT_SERVE_PORT` (3000).

### For Agents: What You Must Do

- **Never hardcode port 3000** in new server code. Use `resolveWorktreePort(3000)` or read from `DEFAULT_SERVE_PORT`.
- When adding a new service that listens on a port, assign it relative to the worktree base port (e.g. `base + 3` for the next available slot).
- The `scripts/setup-worktree-hooks.sh` script installs a `post-checkout` hook that prints the port block on worktree creation. Run it once after cloning.

### Key Files

| File | Role |
|------|------|
| `src/cli/serve/worktree-port.ts` | Core: worktree detection + FNV-1a hash + port resolution |
| `src/cli/serve/serve.ts` | `DEFAULT_SERVE_PORT`, used by CLI `serve` command |
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
