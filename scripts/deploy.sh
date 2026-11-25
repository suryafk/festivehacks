#!/usr/bin/env bash
# Build the image on the VM, load it into k3s, and (re)deploy.
#   ./scripts/deploy.sh [letsencrypt-email]
# Host defaults to <public-ip>.sslip.io (free wildcard DNS), override with HOST=your.domain.
set -euo pipefail
cd "$(dirname "$0")/.."
export KUBECONFIG=${KUBECONFIG:-$HOME/.kube/config}

EMAIL=${1:-${ACME_EMAIL:-}}
IP=$(curl -fsS https://api.ipify.org)
HOST=${HOST:-$(echo "$IP" | tr . -).sslip.io}
[ -f .env ] || { echo "Missing .env (cp .env.example .env)"; exit 1; }

echo "▶ Building image"
docker build -t marg-bandhu:latest .
echo "▶ Importing image into k3s containerd"
docker save marg-bandhu:latest | sudo k3s ctr images import -

if [ -n "$EMAIL" ]; then
  echo "▶ Enabling Let's Encrypt on Traefik"
  sed "s/EMAIL_PLACEHOLDER/$EMAIL/" k8s/traefik-letsencrypt.yaml | kubectl apply -f -
fi

kubectl apply -f <(sed "s/HOST_PLACEHOLDER/$HOST/g" k8s/app.yaml)

# .env → secret (PUBLIC_BASE_URL defaults to the host we just configured)
grep -q '^PUBLIC_BASE_URL=https://[^Y]' .env || sed -i.bak "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://$HOST#" .env
kubectl -n marg-bandhu create secret generic marg-bandhu-env --from-env-file=<(grep -v '^\s*#' .env | grep '=') --dry-run=client -o yaml | kubectl apply -f -

kubectl -n marg-bandhu rollout restart deploy/api deploy/pool-watcher
kubectl -n marg-bandhu rollout status deploy/api --timeout=180s
kubectl -n marg-bandhu get pods -o wide

echo
echo "✅ Live at: https://$HOST"
echo "   Ops:     https://$HOST/#/ops"
echo "   Twilio 'When a message comes in' webhook → https://$HOST/webhooks/whatsapp (POST)"
