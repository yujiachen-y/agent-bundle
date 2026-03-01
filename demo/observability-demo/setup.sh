#!/usr/bin/env bash
set -euo pipefail

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1. Please install it first."
}

require_env() {
  [ -n "${!1:-}" ] || fail "$1 is required."
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

require_env OPENROUTER_API_KEY

info "Checking prerequisites"
for cmd in node npm; do
  check_cmd "$cmd"
done
ok "All prerequisites found"

info "Installing npm dependencies"
npm ci
ok "Dependencies installed"

info "Building observability-demo bundle"
npx agent-bundle build --config ./agent-bundle.yaml
ok "Bundle built"

info "Generating observability-demo package"
npx agent-bundle generate --config ./agent-bundle.yaml
ok "Package generated"

info "Starting observability demo server"
exec ./node_modules/.bin/tsx main.ts
