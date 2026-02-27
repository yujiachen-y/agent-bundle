#!/usr/bin/env bash
# ------------------------------------------------------------------
# Personalized recommend demo — one-command setup + start
#
# Usage (from repo root):
#   E2B_API_KEY=... ANTHROPIC_API_KEY=... ./demo/personalized-recommend/setup.sh
#
# What it does:
#   1. Validates API keys and prerequisites
#   2. Builds bundle artifacts
#   3. Generates bundle code
#   4. Builds TypeScript project
#   5. Starts custom demo server + MCP servers
# ------------------------------------------------------------------
set -euo pipefail

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1. Please install it first."
}

if [ -z "${E2B_API_KEY:-}" ]; then
  fail "E2B_API_KEY is required."
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  fail "ANTHROPIC_API_KEY is required."
fi

info "Checking prerequisites"
for cmd in pnpm node; do
  check_cmd "$cmd"
done
ok "All prerequisites found"

info "Building personalized-recommend bundle"
pnpm exec tsx src/cli/index.ts build --config demo/personalized-recommend/agent-bundle.yaml
ok "Bundle built"

info "Generating personalized-recommend package"
pnpm exec tsx src/cli/index.ts generate --config demo/personalized-recommend/agent-bundle.yaml
ok "Package generated"

info "Building TypeScript project"
pnpm build
ok "Build complete"

info "Starting personalized-recommend demo server"
exec pnpm exec tsx demo/personalized-recommend/main.ts
