#!/usr/bin/env bash
# Install a post-checkout Git hook that prints the assigned worktree port
# block when a new worktree is created.
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

# ── FNV-1a 32-bit in pure bash ──────────────────────────────────
fnv1a32() {
  local input="$1"
  local hash=2166136261 # 0x811c9dc5
  local i byte
  for (( i = 0; i < ${#input}; i++ )); do
    printf -v byte '%d' "'${input:$i:1}"
    hash=$(( (hash ^ byte) * 16777619 ))           # 0x01000193
    hash=$(( hash & 0xFFFFFFFF ))                   # keep 32-bit
  done
  echo "$hash"
}

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
# Print the deterministic port block when a new worktree is created.
# A new worktree has previous_ref = 0000...0000.
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
  _ab_offset=$(( (_ab_hash % 99 + 1) * 10 ))
  _ab_port=$(( 3000 + _ab_offset ))
  echo ""
  echo "  [agent-bundle] Worktree port block: ${_ab_port}-$((_ab_port + 9))"
  echo "  [agent-bundle]   serve:  ${_ab_port}"
  echo "  [agent-bundle]   code-formatter/e2b: $((_ab_port + 1))"
  echo "  [agent-bundle]   code-formatter/k8s: $((_ab_port + 2))"
  echo "  [agent-bundle]   financial-plugin: $((_ab_port + 3))"
  echo "  [agent-bundle]   personalized-recommend: $((_ab_port + 5))"
  echo ""
fi
# ── end agent-bundle-worktree-port ──────────────────────────────
HOOK_EOF

chmod +x "$HOOK_FILE"
echo "post-checkout hook installed at $HOOK_FILE"
