#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

CLUSTER_NAME="agent-sandbox"
CONFIG_PATH="${SCRIPT_DIR}/agent-bundle.yaml"
KUBECONFIG_PATH="/tmp/${CLUSTER_NAME}.kubeconfig"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m ✓\033[0m  %s\n' "$*"; }
fail()  { printf '\033[1;31m ✗\033[0m  %s\n' "$*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  fail "OPENROUTER_API_KEY is required."
fi

info "Checking prerequisites"
for cmd in docker k3d kubectl node npm; do
  check_cmd "$cmd"
done
ok "All prerequisites found"

info "Installing demo dependencies"
npm ci
ok "Dependencies installed"

if k3d cluster list -o json 2>/dev/null | grep -q "\"name\":\"${CLUSTER_NAME}\""; then
  ok "k3d cluster '${CLUSTER_NAME}' already exists"
else
  info "Creating k3d cluster '${CLUSTER_NAME}'"
  k3d cluster create "${CLUSTER_NAME}"
  ok "Cluster created"
fi

info "Building sandbox images via agent-bundle build"
npm run build
ok "Sandbox images built"

AGENT_BUNDLE_VERSION="$(node --input-type=module -e "import { readFileSync } from 'node:fs'; import { join } from 'node:path'; const pkg = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/agent-bundle/package.json'), 'utf8')); process.stdout.write(pkg.version);")"
EXECD_IMAGE="agent-bundle/execd:${AGENT_BUNDLE_VERSION}"
DEMO_IMAGE="$(
  awk '
    /^sandbox:[[:space:]]*$/ { in_sandbox=1; next }
    in_sandbox && /^[^[:space:]]/ { in_sandbox=0; in_k8s=0 }
    in_sandbox && /^[[:space:]][[:space:]]kubernetes:[[:space:]]*$/ { in_k8s=1; next }
    in_k8s && /^[[:space:]][[:space:]][a-zA-Z0-9_-]+:[[:space:]]*$/ && !/^[[:space:]][[:space:]]kubernetes:/ { in_k8s=0 }
    in_k8s && /^[[:space:]][[:space:]][[:space:]][[:space:]]image:[[:space:]]*/ {
      sub(/^[[:space:]][[:space:]][[:space:]][[:space:]]image:[[:space:]]*/, "", $0)
      print $0
      exit
    }
  ' "${CONFIG_PATH}"
)"

if [ -z "${DEMO_IMAGE}" ]; then
  fail "Failed to read sandbox.kubernetes.image from ${CONFIG_PATH}"
fi

info "Importing ${EXECD_IMAGE} into k3d cluster"
k3d image import "${EXECD_IMAGE}" -c "${CLUSTER_NAME}"
ok "Imported ${EXECD_IMAGE}"

info "Importing ${DEMO_IMAGE} into k3d cluster"
k3d image import "${DEMO_IMAGE}" -c "${CLUSTER_NAME}"
ok "Imported ${DEMO_IMAGE}"

info "Generating fixed kubeconfig -> ${KUBECONFIG_PATH}"
k3d kubeconfig get "${CLUSTER_NAME}" \
  | sed 's#https://host.docker.internal:#https://127.0.0.1:#' \
  > "${KUBECONFIG_PATH}"
export KUBECONFIG="${KUBECONFIG_PATH}"
ok "Kubeconfig written"

info "Verifying cluster connectivity"
if kubectl get nodes --no-headers 2>/dev/null | grep -q "Ready"; then
  ok "Cluster is reachable and Ready"
else
  fail "Cannot reach cluster. Check 'docker ps' and 'k3d cluster list'."
fi

info "Starting development server"
if [ -n "${PORT:-}" ]; then
  exec npm run dev -- --config "${CONFIG_PATH}" --port "${PORT}"
fi

exec npm run dev -- --config "${CONFIG_PATH}"
