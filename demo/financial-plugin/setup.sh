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

run_agent_bundle() {
  if [ -x "./node_modules/.bin/agent-bundle" ]; then
    ./node_modules/.bin/agent-bundle "$@"
    return
  fi
  npx --yes agent-bundle "$@"
}

exec_agent_bundle() {
  if [ -x "./node_modules/.bin/agent-bundle" ]; then
    exec ./node_modules/.bin/agent-bundle "$@"
  fi
  exec npx --yes agent-bundle "$@"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

require_env E2B_API_KEY
require_env OPENROUTER_API_KEY

info "Checking prerequisites"
for cmd in node npm; do
  check_cmd "$cmd"
done
ok "All prerequisites found"

info "Installing npm dependencies"
npm ci
ok "Dependencies installed"

info "Checking E2B API access with SDK"
if node -e "import('e2b').then(async ({ Template }) => { await Template.exists('financial-analyst-demo'); }).catch(() => process.exit(1));" >/dev/null 2>&1; then
  ok "E2B API access works"
else
  fail "Unable to access E2B API with current credentials. Verify E2B_API_KEY and network connectivity."
fi

info "Building E2B demo bundle and template"
run_agent_bundle build --config ./agent-bundle.yaml
ok "E2B demo bundle built"

info "Starting agent-bundle dev"
exec_agent_bundle dev --config ./agent-bundle.yaml ${PORT:+--port "$PORT"}
