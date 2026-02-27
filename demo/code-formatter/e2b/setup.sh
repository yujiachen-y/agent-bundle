#!/usr/bin/env bash
# ------------------------------------------------------------------
# E2B server demo — one-command setup + start
#
# Usage (from repo root):
#   E2B_API_KEY=... OPENAI_API_KEY=sk-... ./demo/code-formatter/e2b/setup.sh
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
if [ -z "${E2B_API_KEY:-}" ]; then
  fail "E2B_API_KEY is required."
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  fail "OPENAI_API_KEY is required."
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

info "Starting server (port auto-detected, see output below)"
exec pnpm exec tsx src/cli/index.ts dev \
  --config demo/code-formatter/e2b/agent-bundle.yaml ${PORT:+--port "$PORT"}
