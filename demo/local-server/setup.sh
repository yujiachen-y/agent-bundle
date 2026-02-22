#!/usr/bin/env bash
# ------------------------------------------------------------------
# Local-server demo — one-command environment setup
#
# Usage:
#   ./demo/local-server/setup.sh          # run from repo root
#   bash demo/local-server/setup.sh       # also fine
#
# What it does:
#   1. Checks prerequisites  (docker, k3d, kubectl, pnpm, node)
#   2. Creates a k3d cluster  (agent-sandbox) if it doesn't exist
#   3. Builds the sandbox Docker images
#   4. Imports the sandbox image into k3d
#   5. Fixes kubeconfig for macOS / Docker Desktop connectivity
#   6. Verifies the cluster is reachable
#
# After this script succeeds, start the server with:
#   ANTHROPIC_API_KEY=sk-... pnpm demo:local-server
# ------------------------------------------------------------------
set -euo pipefail

CLUSTER_NAME="agent-sandbox"
IMAGE_NAME="agent-bundle/local-server-execd:latest"
KUBECONFIG_PATH="/tmp/agent-sandbox.kubeconfig"

# ── helpers ──────────────────────────────────────────────────────
info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1. Please install it first."
}

# ── 1. prerequisites ────────────────────────────────────────────
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

# ── 3. build sandbox images ─────────────────────────────────────
info "Building sandbox images (execd base + demo image)"
pnpm build:demo:local-server
ok "Images built"

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
ok "Kubeconfig written"

# ── 6. verify cluster ───────────────────────────────────────────
info "Verifying cluster connectivity"
if KUBECONFIG="${KUBECONFIG_PATH}" kubectl get nodes --no-headers 2>/dev/null | grep -q "Ready"; then
  ok "Cluster is reachable and Ready"
else
  fail "Cannot reach cluster. Check 'docker ps' and 'k3d cluster list'."
fi

# ── done ─────────────────────────────────────────────────────────
echo ""
info "Setup complete! Start the demo server with:"
echo ""
echo "  export KUBECONFIG=${KUBECONFIG_PATH}"
echo "  ANTHROPIC_API_KEY=<your-key> pnpm demo:local-server"
echo ""
echo "  Or with Anthropic OAuth token:"
echo "  ANTHROPIC_OAUTH_TOKEN=<your-token> pnpm demo:local-server"
echo ""
