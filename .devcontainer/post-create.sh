#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing kubectl"
curl -fsSL "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl" -o /tmp/kubectl
sudo install -o root -g root -m 0755 /tmp/kubectl /usr/local/bin/kubectl
rm /tmp/kubectl
echo "    kubectl $(kubectl version --client --short 2>/dev/null || kubectl version --client)"

echo "==> Installing k3d"
curl -fsSL https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | sudo bash
echo "    $(k3d version)"

echo "==> Fixing Docker credential config"
echo '{}' > "${HOME}/.docker/config.json"

echo "==> Enabling corepack"
sudo corepack enable

echo "==> Installing dependencies"
pnpm install

echo "==> Building agent-bundle"
pnpm build

echo "==> Building execd sandbox base image"
pnpm run build:sandbox:execd

echo "==> Done! Open a terminal and follow the welcome instructions."
