#!/usr/bin/env bash
# ------------------------------------------------------------------
# Personalized recommend demo — one-command setup + start
#
# Usage (from repo root):
#   E2B_API_KEY=... ANTHROPIC_API_KEY=... ./demo/personalized-recommend/setup.sh
#
# What it does:
#   1. Validates API keys and prerequisites
#   2. Bundles memory STDIO server with esbuild
#   3. Builds bundle artifacts (E2B template)
#   4. Generates bundle code
#   5. Builds TypeScript project
#   6. Starts custom demo server + product MCP server
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

info "Bundling memory STDIO server"
mkdir -p demo/personalized-recommend/tools/mcp
pnpm exec esbuild \
  demo/personalized-recommend/mcp/memory-server-stdio.ts \
  --bundle --platform=node --target=node20 --format=esm \
  --outfile=demo/personalized-recommend/tools/mcp/memory-server.mjs \
  '--external:node:*'
ok "STDIO server bundled"

info "Building personalized-recommend bundle"
pnpm exec agent-bundle build --config demo/personalized-recommend/agent-bundle.yaml
ok "Bundle built"

info "Generating personalized-recommend package"
pnpm exec agent-bundle generate --config demo/personalized-recommend/agent-bundle.yaml
ok "Package generated"

info "Building TypeScript project"
pnpm build
ok "Build complete"

info "Starting personalized-recommend demo server"
exec pnpm exec tsx demo/personalized-recommend/main.ts
