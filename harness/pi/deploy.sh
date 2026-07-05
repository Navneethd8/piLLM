#!/usr/bin/env bash
# Sync harness to Pi and run install.sh. Usage:
#   PI_HOST=navneeth@192.168.1.42 ./pi/deploy.sh
#   ./pi/deploy.sh pi@raspberrypi.local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PI_HOST="${1:-${PI_HOST:-}}"
PI_REPO="${PI_REPO:-}"

if [[ -z "$PI_HOST" ]]; then
  echo "Usage: PI_HOST=user@host $0"
  echo "   or: $0 user@host"
  exit 1
fi

if [[ -z "$PI_REPO" ]]; then
  REMOTE_HOME="$(ssh "$PI_HOST" 'echo "$HOME"')"
  PI_REPO="$REMOTE_HOME/piLLM/harness"
fi

echo "==> Deploying harness to $PI_HOST:$PI_REPO"

ssh "$PI_HOST" "mkdir -p $(dirname "$PI_REPO")"

rsync -avz --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .env \
  "$REPO_DIR/" "$PI_HOST:$PI_REPO/"

ssh "$PI_HOST" "cd '$PI_REPO' && bash pi/install.sh '$PI_REPO'"

echo "==> Restarting gateway (if running)..."
ssh "$PI_HOST" "systemctl --user restart pillm-gateway.service 2>/dev/null || true"

echo "==> Deploy complete."
echo "    ssh $PI_HOST 'cd $PI_REPO && npm run cli'"
