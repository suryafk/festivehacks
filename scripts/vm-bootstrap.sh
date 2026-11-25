#!/usr/bin/env bash
# Run ONCE on a fresh Ubuntu 22.04/24.04 VM (2 vCPU / 4 GB is enough):
#   curl -fsSL https://raw.githubusercontent.com/suryafk/festivehacks/main/scripts/vm-bootstrap.sh | bash
# Installs Docker (to build the image), k3s (Kubernetes) and Helm (for the NudgeBee agent), then clones the repo.
set -euo pipefail

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

if ! command -v k3s >/dev/null; then
  curl -sfL https://get.k3s.io | sudo sh -s - --write-kubeconfig-mode 644
fi
mkdir -p ~/.kube && sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config && sudo chown "$USER" ~/.kube/config
grep -q KUBECONFIG ~/.bashrc || echo 'export KUBECONFIG=$HOME/.kube/config' >> ~/.bashrc

if ! command -v helm >/dev/null; then
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi

[ -d ~/festivehacks ] || git clone https://github.com/suryafk/festivehacks.git ~/festivehacks

echo
echo "✅ VM ready. Next:"
echo "   cd ~/festivehacks && cp .env.example .env && nano .env"
echo "   ./scripts/deploy.sh you@example.com      # email is only for the Let's Encrypt certificate"
echo "   (log out and back in once so 'docker' works without sudo)"
