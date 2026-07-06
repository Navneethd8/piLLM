#!/usr/bin/env bash
# Point Ollama model storage at a USB thumb drive (Pi).
# Usage:
#   ./pi/setup-ollama-usb.sh                    # auto-detect largest removable mount
#   OLLAMA_USB_PATH=/media/user/USB ./pi/setup-ollama-usb.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PILLM_HOME="${PILLM_HOME:-$HOME/.pillm}"
OLLAMA_MODELS_DIR="${OLLAMA_MODELS:-}"

detect_usb_mount() {
  if [[ -n "${OLLAMA_USB_PATH:-}" ]]; then
    echo "$OLLAMA_USB_PATH"
    return
  fi

  local candidate=""
  local best_kb=0
  while IFS= read -r line; do
    local mount_kb mount_path
    mount_kb="$(echo "$line" | awk '{print $2}')"
    mount_path="$(echo "$line" | awk '{print $NF}')"
    [[ "$mount_kb" =~ ^[0-9]+$ ]] || continue
    [[ "$mount_path" == /media/* || "$mount_path" == /mnt/* ]] || continue
    if (( mount_kb > best_kb )); then
      best_kb=$mount_kb
      candidate="$mount_path"
    fi
  done < <(df -kP 2>/dev/null | tail -n +2)

  echo "$candidate"
}

USB_MOUNT="$(detect_usb_mount)"
if [[ -z "$USB_MOUNT" ]]; then
  echo "No USB mount found. Set OLLAMA_USB_PATH=/path/to/thumbdrive and retry."
  exit 1
fi

OLLAMA_MODELS_DIR="${OLLAMA_MODELS_DIR:-$USB_MOUNT/ollama-models}"
if [[ ! -d "$OLLAMA_MODELS_DIR" ]]; then
  if mkdir -p "$OLLAMA_MODELS_DIR" 2>/dev/null; then
    :
  elif command -v sudo >/dev/null 2>&1; then
    sudo mkdir -p "$OLLAMA_MODELS_DIR"
  else
    echo "Cannot create $OLLAMA_MODELS_DIR (permission denied)."
    exit 1
  fi
fi

OLLAMA_OWNER="${OLLAMA_OWNER:-ollama}"
if id "$OLLAMA_OWNER" >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
  sudo chown -R "$OLLAMA_OWNER:$OLLAMA_OWNER" "$OLLAMA_MODELS_DIR"
  sudo chmod 775 "$OLLAMA_MODELS_DIR"
elif command -v sudo >/dev/null 2>&1; then
  sudo chown -R "$USER:$USER" "$OLLAMA_MODELS_DIR"
fi

ENV_FILE="$PILLM_HOME/.env"
MARKER="# --- ollama usb (managed by setup-ollama-usb.sh) ---"

if [[ -f "$ENV_FILE" ]] && grep -qF "$MARKER" "$ENV_FILE"; then
  sed -i "/$MARKER/,/^$/d" "$ENV_FILE" || true
fi

{
  echo ""
  echo "$MARKER"
  echo "OLLAMA_MODELS=$OLLAMA_MODELS_DIR"
  echo ""
} >> "$ENV_FILE"

mkdir -p "$HOME/.config/systemd/user/ollama.service.d"
cat > "$HOME/.config/systemd/user/ollama.service.d/usb-models.conf" <<EOF
[Service]
Environment=OLLAMA_MODELS=$OLLAMA_MODELS_DIR
Environment=OLLAMA_MAX_LOADED_MODELS=1
Environment=OLLAMA_NUM_PARALLEL=1
EOF

if systemctl --user list-unit-files ollama.service >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user restart ollama.service || true
elif systemctl list-unit-files ollama.service >/dev/null 2>&1; then
  sudo mkdir -p /etc/systemd/system/ollama.service.d
  sudo tee /etc/systemd/system/ollama.service.d/usb-models.conf >/dev/null <<EOF
[Service]
Environment=OLLAMA_MODELS=$OLLAMA_MODELS_DIR
Environment=OLLAMA_MAX_LOADED_MODELS=1
Environment=OLLAMA_NUM_PARALLEL=1
EOF
  sudo systemctl daemon-reload
  sudo systemctl restart ollama.service || true
else
  echo "Note: ollama.service not found. Export before starting Ollama:"
  echo "  export OLLAMA_MODELS=$OLLAMA_MODELS_DIR"
fi

echo "==> Ollama models directory: $OLLAMA_MODELS_DIR"
echo "    Saved to $ENV_FILE and systemd drop-in."
echo "    All benchmark pulls will land on the thumb drive."
