#!/usr/bin/env bash
# ------------------------------------------------------------------
# K8s server demo — one-command setup + start
#
# Usage (from repo root):
#   ANTHROPIC_API_KEY=sk-... ./demo/server/k8s/setup.sh
#   ANTHROPIC_OAUTH_TOKEN=... ./demo/server/k8s/setup.sh
#
# What it does:
#   1. Validates API key and prerequisites
#   2. Creates a k3d cluster (agent-sandbox) if it doesn't exist
#   3. Builds the sandbox Docker images + generates agent code
#   4. Imports the sandbox image into k3d
#   5. Fixes kubeconfig for macOS / Docker Desktop connectivity
#   6. Verifies the cluster is reachable
#   7. Builds the TypeScript project and starts the HTTP server
# ------------------------------------------------------------------
set -euo pipefail

CLUSTER_NAME="agent-sandbox"
IMAGE_NAME="agent-bundle/k8s-server-execd:latest"
KUBECONFIG_PATH="/tmp/agent-sandbox.kubeconfig"

# ── helpers ──────────────────────────────────────────────────────
info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1. Please install it first."
}

# ── 1. API key + prerequisites ────────────────────────────────────
# Fall back to CLAUDE_CODE_OAUTH_TOKEN when ANTHROPIC_OAUTH_TOKEN is unset
# (matches the key name used in some secret stores like Infisical).
export ANTHROPIC_OAUTH_TOKEN="${ANTHROPIC_OAUTH_TOKEN:-${CLAUDE_CODE_OAUTH_TOKEN:-}}"

if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_OAUTH_TOKEN:-}" ]; then
  fail "An API key is required. Set ANTHROPIC_API_KEY, ANTHROPIC_OAUTH_TOKEN, or CLAUDE_CODE_OAUTH_TOKEN."
fi

info "Checking prerequisites"
for cmd in docker k3d kubectl pnpm node; do
  check_cmd "$cmd"
done
ok "All prerequisites found"

# ── 2. k3d cluster ──────────────────────────────────────────────
if k3d cluster list -o json 2>/dev/null | grep -q "\"name\":\"${CLUSTER_NAME}\""; then
  ok "k3d cluster '${CLUSTER_NAME}' already exists"
else
  info "Creating k3d cluster '${CLUSTER_NAME}'"
  k3d cluster create "${CLUSTER_NAME}"
  ok "Cluster created"
fi

# ── 3. build sandbox images + generate agent code ─────────────────
info "Building sandbox images (execd base + demo image) and generating agent code"
pnpm build:demo:k8s-server
ok "Images built and agent code generated"

# ── 4. import image into k3d ────────────────────────────────────
info "Importing ${IMAGE_NAME} into k3d cluster"
k3d image import "${IMAGE_NAME}" -c "${CLUSTER_NAME}"
ok "Image imported"

# ── 5. fix kubeconfig ───────────────────────────────────────────
# k3d on macOS often writes host.docker.internal as the API server
# address, which is unreachable from the host. Rewrite to 127.0.0.1.
info "Generating fixed kubeconfig → ${KUBECONFIG_PATH}"
k3d kubeconfig get "${CLUSTER_NAME}" \
  | sed 's#https://host.docker.internal:#https://127.0.0.1:#' \
  > "${KUBECONFIG_PATH}"
export KUBECONFIG="${KUBECONFIG_PATH}"
ok "Kubeconfig written"

# ── 6. verify cluster ───────────────────────────────────────────
info "Verifying cluster connectivity"
if kubectl get nodes --no-headers 2>/dev/null | grep -q "Ready"; then
  ok "Cluster is reachable and Ready"
else
  fail "Cannot reach cluster. Check 'docker ps' and 'k3d cluster list'."
fi

# ── 7. build project + start server ──────────────────────────────
info "Building TypeScript project"
pnpm build
ok "Build complete"

info "Starting server (port auto-detected, see output below)"
exec pnpm exec tsx demo/server/k8s/main.ts
