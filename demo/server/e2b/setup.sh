#!/usr/bin/env bash
set -euo pipefail

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

info "Checking prerequisites"
for cmd in pnpm node curl; do
  check_cmd "$cmd"
done
ok "All prerequisites found"

if [ -z "${E2B_API_KEY:-}" ]; then
  fail "E2B_API_KEY is required. Run with injected secrets (for example: infisical run --env=dev -- ./demo/server/e2b/setup.sh)."
fi

info "Checking E2B API access with SDK"
if pnpm exec tsx -e "import { Template } from 'e2b'; void (async () => { await Template.exists('code-formatter-e2b-demo'); })();" >/dev/null 2>&1; then
  ok "E2B API access works"
else
  fail "Unable to access E2B API with current credentials. Verify E2B_API_KEY and network connectivity."
fi

info "Building e2b demo bundle and template"
pnpm build:demo:e2b-server
ok "E2B demo bundle built"

echo ""
info "Setup complete. Start server with:"
echo ""
echo "  PORT=3001 pnpm demo:e2b-server"
echo "  # if only CLAUDE_CODE_OAUTH_TOKEN is available:"
echo "  export ANTHROPIC_OAUTH_TOKEN=\${ANTHROPIC_OAUTH_TOKEN:-\${CLAUDE_CODE_OAUTH_TOKEN:-}}"
echo "  PORT=3001 pnpm demo:e2b-server"
echo ""
echo "If you use Infisical:"
echo "  infisical run --env=dev -- sh -lc 'PORT=3001 pnpm demo:e2b-server'"
echo "  infisical run --env=dev -- sh -lc 'export ANTHROPIC_OAUTH_TOKEN=\"\${ANTHROPIC_OAUTH_TOKEN:-\${CLAUDE_CODE_OAUTH_TOKEN:-}}\"; PORT=3001 pnpm demo:e2b-server'"
