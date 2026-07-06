#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
PILLM_HOME="${PILLM_HOME:-$HOME/.pillm}"
PILLM_WORKSPACE="${PILLM_WORKSPACE:-$REPO_DIR}"

echo "==> piLLM harness install"
echo "    repo:      $REPO_DIR"
echo "    home:      $PILLM_HOME"
echo "    workspace: $PILLM_WORKSPACE"

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 18..."
  sudo apt-get update -qq
  sudo apt-get install -y nodejs npm build-essential python3
fi

echo "==> Node $(node --version)"

mkdir -p "$PILLM_HOME/data" "$PILLM_HOME/skills" "$PILLM_HOME/sessions"

if [[ ! -f "$PILLM_HOME/.env" ]]; then
  cp "$REPO_DIR/pi/config.example.env" "$PILLM_HOME/.env"
  sed -i "s|/home/navneeth|$HOME|g" "$PILLM_HOME/.env" || true
  sed -i "s|PILLM_WORKSPACE=.*|PILLM_WORKSPACE=$PILLM_WORKSPACE|" "$PILLM_HOME/.env" || true
  echo "==> Created $PILLM_HOME/.env — edit DISCORD_BOT_TOKEN if needed"
fi

for f in SOUL.md MEMORY.md; do
  if [[ ! -f "$PILLM_HOME/data/$f" && -f "$REPO_DIR/data/$f" ]]; then
    cp "$REPO_DIR/data/$f" "$PILLM_HOME/data/$f"
  fi
done

cd "$REPO_DIR"
npm install
npm run build

echo "==> Installing systemd user services..."
mkdir -p "$HOME/.config/systemd/user"

sed "s|@HOME@|$HOME|g; s|@REPO@|$REPO_DIR|g" "$REPO_DIR/pi/systemd/pillm-gateway.service.in" \
  > "$HOME/.config/systemd/user/pillm-gateway.service"

systemctl --user daemon-reload
systemctl --user enable pillm-gateway.service

if command -v loginctl >/dev/null 2>&1; then
  sudo loginctl enable-linger "$USER" 2>/dev/null || true
fi

echo ""
echo "==> Done. Commands:"
echo "    cd $REPO_DIR && npm run cli          # interactive"
echo "    bash $REPO_DIR/pi/benchmark.sh       # find best local model"
echo "    curl http://127.0.0.1:8787/health    # web health"
echo "    systemctl --user start pillm-gateway # background (web + discord)"
echo "    journalctl --user -u pillm-gateway -f"
