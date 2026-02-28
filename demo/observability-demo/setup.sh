#!/usr/bin/env bash
# ------------------------------------------------------------------
# Observability demo — one-command setup + start
#
# Usage (from repo root):
#   OPENAI_API_KEY=... ./demo/observability-demo/setup.sh
#
# What it does:
#   1. Validates API key and prerequisites
#   2. Builds bundle artifacts
#   3. Generates bundle code
#   4. Builds TypeScript project
#   5. Starts demo server with OTEL console exporters
# ------------------------------------------------------------------
set -euo pipefail

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1. Please install it first."
}

if [ -z "${OPENAI_API_KEY:-}" ]; then
  fail "OPENAI_API_KEY is required."
fi

info "Checking prerequisites"
for cmd in pnpm node; do
  check_cmd "$cmd"
done
ok "All prerequisites found"

info "Building observability-demo bundle"
pnpm exec agent-bundle build --config demo/observability-demo/agent-bundle.yaml
ok "Bundle built"

info "Generating observability-demo package"
pnpm exec agent-bundle generate --config demo/observability-demo/agent-bundle.yaml
ok "Package generated"

info "Building TypeScript project"
pnpm build
ok "Build complete"

info "Starting observability demo server"
exec pnpm exec tsx demo/observability-demo/main.ts
