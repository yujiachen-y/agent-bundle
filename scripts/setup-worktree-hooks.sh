#!/usr/bin/env bash
# Install a post-checkout Git hook that prints deterministic worktree ports
# when a new worktree is created.
#
# Usage:  bash scripts/setup-worktree-hooks.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

HOOKS_DIR="$REPO_ROOT/.git/hooks"
HOOK_FILE="$HOOKS_DIR/post-checkout"

# ── Create hook ─────────────────────────────────────────────────
if [[ -f "$HOOK_FILE" ]]; then
  if grep -q 'agent-bundle-worktree-port' "$HOOK_FILE" 2>/dev/null; then
    echo "post-checkout hook already contains worktree port logic — skipping."
    exit 0
  fi
  echo "warning: $HOOK_FILE already exists. Appending worktree port block." >&2
fi

cat >> "$HOOK_FILE" << 'HOOK_EOF'

# ── agent-bundle-worktree-port ──────────────────────────────────
# Print deterministic service ports when a new worktree is created.
# A new worktree has previous_ref = 0000...0000.
#
# Port model (same as src/cli/serve/worktree-port.ts):
#   port = prefix * 1000 + suffix
#   prefix: 10-63 (FNV-1a hash of worktree name)
#   suffix:
#     000 = serve/dev (CLI main service + config-only demos)
#     005 = demo/personalized-recommend
#     006 = demo/observability-demo
_ab_prev_ref="$1"
if [ "$_ab_prev_ref" = "0000000000000000000000000000000000000000" ]; then
  _ab_wt_name="$(basename "$(pwd)")"
  _ab_fnv1a32() {
    local input="$1" hash=2166136261 i byte
    for (( i = 0; i < ${#input}; i++ )); do
      printf -v byte '%d' "'${input:$i:1}"
      hash=$(( (hash ^ byte) * 16777619 ))
      hash=$(( hash & 0xFFFFFFFF ))
    done
    echo "$hash"
  }
  _ab_hash=$(_ab_fnv1a32 "$_ab_wt_name")
  _ab_prefix=$((10 + (_ab_hash % 54)))
  _ab_base=$((_ab_prefix * 1000))
  echo ""
  echo "  [agent-bundle] Worktree prefix: ${_ab_prefix}"
  echo "  [agent-bundle] Port range: ${_ab_base}-$((_ab_base + 999))"
  echo "  [agent-bundle]   serve/dev: ${_ab_base}"
  echo "  [agent-bundle]   personalized-recommend: $((_ab_base + 5))"
  echo "  [agent-bundle]   observability-demo: $((_ab_base + 6))"
  echo ""
fi
# ── end agent-bundle-worktree-port ──────────────────────────────
HOOK_EOF

chmod +x "$HOOK_FILE"
echo "post-checkout hook installed at $HOOK_FILE"
