#!/usr/bin/env bash
# ------------------------------------------------------------------
# E2B formatter demo — one-command setup + start
#
# Usage (from this directory):
#   E2B_API_KEY=... OPENROUTER_API_KEY=... ./setup.sh
#
# What it does:
#   1. Validates API keys and prerequisites
#   2. Installs demo dependencies
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

# ── 2. install dependencies ───────────────────────────────────────
info "Installing demo dependencies"
npm ci
ok "Demo dependencies installed"

# ── 3. build E2B demo bundle and template ─────────────────────────
info "Building E2B demo bundle and template"
npx agent-bundle build
ok "E2B demo bundle built"

# ── 4. start dev server ───────────────────────────────────────────
info "Starting agent-bundle dev server (port auto-detected, see output below)"
exec npx agent-bundle dev ${PORT:+--port "$PORT"}
