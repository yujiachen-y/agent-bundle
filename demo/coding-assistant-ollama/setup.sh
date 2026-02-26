#!/usr/bin/env bash
# ------------------------------------------------------------------
# Ollama TUI demo — one-command setup + start
#
# Usage (from repo root):
#   E2B_API_KEY=... ./demo/coding-assistant-ollama/setup.sh
#
# What it does:
#   1. Validates prerequisites (Ollama running, E2B API key)
#   2. Builds the demo bundle, E2B template, and generates agent code
#   3. Builds the TypeScript project and starts the TUI
# ------------------------------------------------------------------
set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────
info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1. Please install it first."
}

# ── 1. prerequisites ────────────────────────────────────────────
if [ -z "${E2B_API_KEY:-}" ]; then
  fail "E2B_API_KEY is required."
fi

info "Checking prerequisites"
for cmd in pnpm node ollama; do
  check_cmd "$cmd"
done
ok "All prerequisites found"

# ── 2. verify Ollama is running ─────────────────────────────────
info "Checking Ollama availability"
if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  ok "Ollama is running"
else
  fail "Ollama is not reachable at http://localhost:11434. Run 'ollama serve' first."
fi

# ── 3. verify E2B API access ───────────────────────────────────
info "Checking E2B API access with SDK"
if pnpm exec tsx -e "import { Template } from 'e2b'; void (async () => { await Template.exists('coding-assistant-ollama-demo'); })();" >/dev/null 2>&1; then
  ok "E2B API access works"
else
  fail "Unable to access E2B API with current credentials. Verify E2B_API_KEY and network connectivity."
fi

# ── 4. build demo bundle, template, and generate agent code ────
info "Building Ollama TUI demo bundle, template, and generating agent code"
pnpm build:demo:tui-ollama
ok "Demo bundle built and agent code generated"

# ── 5. generate package link for @agent-bundle/* imports ───────
info "Generating package link"
pnpm exec tsx src/cli/index.ts generate --config demo/tui/ollama/agent-bundle.yaml
ok "Package link created"

# ── 6. build project + start TUI ───────────────────────────────
info "Building TypeScript project"
pnpm build
ok "Build complete"

info "Starting TUI (type a question at the > prompt, Ctrl+C twice to exit)"
exec pnpm exec tsx demo/coding-assistant-ollama/main.ts
