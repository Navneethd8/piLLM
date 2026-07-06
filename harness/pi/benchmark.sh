#!/usr/bin/env bash
# Pull Pi candidate models (to USB if configured) and run the harness benchmark.
# Usage:
#   ./pi/benchmark.sh
#   OLLAMA_USB_PATH=/media/navneeth/USB ./pi/benchmark.sh
#   PILLM_BENCHMARK_MODELS=qwen2.5:0.5b,llama3.2:1b ./pi/benchmark.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PILLM_HOME="${PILLM_HOME:-$HOME/.pillm}"

if [[ -f "$PILLM_HOME/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$PILLM_HOME/.env"
  set +a
fi

if [[ -n "${OLLAMA_USB_PATH:-}" || -z "${OLLAMA_MODELS:-}" ]]; then
  bash "$SCRIPT_DIR/setup-ollama-usb.sh" || true
  if [[ -f "$PILLM_HOME/.env" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$PILLM_HOME/.env"
    set +a
  fi
fi

if [[ -n "${OLLAMA_MODELS:-}" ]]; then
  export OLLAMA_MODELS
  echo "==> Using OLLAMA_MODELS=$OLLAMA_MODELS"
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama not installed. Install from https://ollama.com/download/linux"
  exit 1
fi

if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "==> Starting Ollama..."
  if systemctl --user start ollama.service 2>/dev/null; then
    sleep 2
  elif systemctl start ollama.service 2>/dev/null; then
    sleep 2
  else
    OLLAMA_HOST=127.0.0.1:11434 ollama serve >/tmp/ollama-serve.log 2>&1 &
    sleep 3
  fi
fi

MODELS=()
if [[ -n "${PILLM_BENCHMARK_MODELS:-}" ]]; then
  IFS=',' read -ra MODELS <<< "$PILLM_BENCHMARK_MODELS"
else
  mapfile -t MODELS < <(node -e "
    const m = require('$REPO_DIR/eval/models.json');
    m.models.forEach((x) => console.log(x));
  ")
fi

echo "==> Pulling ${#MODELS[@]} models (stored under \${OLLAMA_MODELS:-~/.ollama/models})..."
for model in "${MODELS[@]}"; do
  model="$(echo "$model" | xargs)"
  [[ -z "$model" ]] && continue
  echo "    pull $model"
  ollama pull "$model"
done

cd "$REPO_DIR"
npm run build

export OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}"
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}"
# USB-backed models on 1GB Pi: cold load can exceed 10 min for 1B+ GGUF (I/O + swap)
export PILLM_BENCHMARK_LOAD_PROBE_MS="${PILLM_BENCHMARK_LOAD_PROBE_MS:-900000}"
echo "==> Ollama limits: MAX_LOADED_MODELS=$OLLAMA_MAX_LOADED_MODELS NUM_PARALLEL=$OLLAMA_NUM_PARALLEL"
echo "==> Load probe timeout: ${PILLM_BENCHMARK_LOAD_PROBE_MS}ms"

LATEST_LINK="$PILLM_HOME/benchmarks/latest.json"
export PILLM_BENCHMARK_OUTPUT="$LATEST_LINK"
npm run benchmark

if [[ -f "$LATEST_LINK" ]]; then
  WINNER="$(node -e "
    const r = require('$LATEST_LINK');
    const ok = r.summaries?.some((s) => s.model === r.winner && s.reliability >= 0.8);
    console.log(ok ? (r.winner || '') : '');
  ")"
  if [[ -n "$WINNER" && -f "$PILLM_HOME/.env" ]]; then
    if grep -q '^OLLAMA_MODEL=' "$PILLM_HOME/.env"; then
      sed -i "s|^OLLAMA_MODEL=.*|OLLAMA_MODEL=$WINNER|" "$PILLM_HOME/.env"
    else
      echo "OLLAMA_MODEL=$WINNER" >> "$PILLM_HOME/.env"
    fi
    echo "==> Updated OLLAMA_MODEL=$WINNER in $PILLM_HOME/.env"
    systemctl --user restart pillm-gateway.service 2>/dev/null || true
  fi
fi

echo "==> Benchmark complete. Report: $LATEST_LINK"
