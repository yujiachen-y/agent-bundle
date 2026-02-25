#!/usr/bin/env bash
# ------------------------------------------------------------------
# E2B server demo — one-command setup + start
#
# Usage (from repo root):
#   E2B_API_KEY=... ANTHROPIC_API_KEY=sk-... ./demo/server/e2b/setup.sh
#   infisical run --env=dev -- ./demo/server/e2b/setup.sh
#
# What it does:
#   1. Validates API keys and prerequisites
#   2. Verifies E2B API access
#   3. Builds the E2B demo bundle and template
#   4. Builds the TypeScript project and starts the HTTP server
# ------------------------------------------------------------------
set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────
info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1. Please install it first."
}

# ── 1. API keys + prerequisites ───────────────────────────────────
# Fall back to CLAUDE_CODE_OAUTH_TOKEN when ANTHROPIC_OAUTH_TOKEN is unset
# (matches the key name used in some secret stores like Infisical).
export ANTHROPIC_OAUTH_TOKEN="${ANTHROPIC_OAUTH_TOKEN:-${CLAUDE_CODE_OAUTH_TOKEN:-}}"

if [ -z "${E2B_API_KEY:-}" ]; then
  fail "E2B_API_KEY is required. Set it directly or use a secret manager (e.g. infisical run --env=dev -- ./demo/server/e2b/setup.sh)."
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_OAUTH_TOKEN:-}" ]; then
  fail "A model API key is required. Set ANTHROPIC_API_KEY, ANTHROPIC_OAUTH_TOKEN, or CLAUDE_CODE_OAUTH_TOKEN."
fi

info "Checking prerequisites"
for cmd in pnpm node; do
  check_cmd "$cmd"
done
ok "All prerequisites found"

# ── 2. verify E2B API access ─────────────────────────────────────
info "Checking E2B API access with SDK"
if pnpm exec tsx -e "import { Template } from 'e2b'; void (async () => { await Template.exists('code-formatter-e2b-demo'); })();" >/dev/null 2>&1; then
  ok "E2B API access works"
else
  fail "Unable to access E2B API with current credentials. Verify E2B_API_KEY and network connectivity."
fi

# ── 3. build E2B demo bundle and template ─────────────────────────
info "Building E2B demo bundle and template"
pnpm build:demo:e2b-server
ok "E2B demo bundle built"

# ── 4. build project + start server ──────────────────────────────
info "Building TypeScript project"
pnpm build
ok "Build complete"

info "Starting server on http://localhost:${PORT:-3001}"
exec pnpm exec tsx demo/server/e2b/main.ts
