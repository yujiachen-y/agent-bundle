#!/usr/bin/env bash
# ------------------------------------------------------------------
# E2B formatter demo — one-command setup + start
#
# Usage (from this directory):
#   E2B_API_KEY=... OPENROUTER_API_KEY=... ./setup.sh
#
# What it does:
#   1. Validates API keys and prerequisites
#   2. Ensures agent-bundle CLI is available (local/global/npx fallback)
#   3. Builds the E2B demo bundle and template
#   4. Starts agent-bundle dev server
# ------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# ── helpers ──────────────────────────────────────────────────────
info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1. Please install it first."
}

run_agent_bundle() {
  if [ -x "./node_modules/.bin/agent-bundle" ]; then
    ./node_modules/.bin/agent-bundle "$@"
    return
  fi

  if command -v agent-bundle >/dev/null 2>&1; then
    agent-bundle "$@"
    return
  fi

  npx -y agent-bundle@latest "$@"
}

exec_agent_bundle() {
  if [ -x "./node_modules/.bin/agent-bundle" ]; then
    exec ./node_modules/.bin/agent-bundle "$@"
  fi

  if command -v agent-bundle >/dev/null 2>&1; then
    exec agent-bundle "$@"
  fi

  exec npx -y agent-bundle@latest "$@"
}

# ── 1. API keys + prerequisites ───────────────────────────────────
if [ -z "${E2B_API_KEY:-}" ]; then
  fail "E2B_API_KEY is required."
fi

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  fail "OPENROUTER_API_KEY is required."
fi

info "Checking prerequisites"
for cmd in node npm; do
  check_cmd "$cmd"
done
ok "All prerequisites found"

# ── 2. ensure CLI availability ────────────────────────────────────
if [ ! -x "./node_modules/.bin/agent-bundle" ] && [ -f "./package.json" ]; then
  info "Installing demo dependencies"
  npm ci
  ok "Demo dependencies installed"
fi

info "Checking agent-bundle CLI availability"
if run_agent_bundle --help >/dev/null 2>&1; then
  ok "agent-bundle CLI is available"
else
  fail "Unable to run agent-bundle CLI. Install it globally or ensure npm can access the registry."
fi

# ── 3. build E2B demo bundle and template ─────────────────────────
info "Building E2B demo bundle and template"
run_agent_bundle build
ok "E2B demo bundle built"

# ── 4. start dev server ───────────────────────────────────────────
info "Starting agent-bundle dev server (port auto-detected, see output below)"
if [ -n "${PORT:-}" ]; then
  exec_agent_bundle dev --port "${PORT}"
fi
exec_agent_bundle dev
