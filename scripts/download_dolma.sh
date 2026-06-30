#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="${1:-$ROOT/data/manifests/train_100m_v17.txt}"
OUT="$ROOT/data/dolma/raw"
PARALLEL="${PARALLEL:-2}"

if [[ ! -f "$MANIFEST" ]]; then
  echo "Manifest not found: $MANIFEST" >&2
  exit 1
fi

mkdir -p "$OUT"
TOTAL="$(wc -l < "$MANIFEST" | tr -d ' ')"
echo "Downloading $TOTAL shards from $MANIFEST"
echo "Output: $OUT (parallel=$PARALLEL, resume with curl -C -)"

export OUT
cat "$MANIFEST" | xargs -n 1 -P "$PARALLEL" -I {} sh -c '
  url="$1"
  file="$OUT/$(basename "$url")"
  if curl -C - -f -L --retry 5 --retry-delay 10 -o "$file" "$url"; then
    echo "OK $(basename "$file")"
  else
    echo "FAIL $(basename "$file")" >&2
    exit 1
  fi
' _ {}

DONE="$(find "$OUT" -maxdepth 1 -name '*.json.gz' ! -name '._*' | wc -l | tr -d ' ')"
BYTES="$(find "$OUT" -maxdepth 1 -name '*.json.gz' ! -name '._*' -exec stat -f%z {} + 2>/dev/null | awk '{s+=$1} END {printf "%.1f GB", s/1024/1024/1024}')"
echo "Done: $DONE / $TOTAL files ($BYTES) in $OUT"

if [[ "$DONE" -ne "$TOTAL" ]]; then
  echo "Re-run the same command to resume failed/partial downloads." >&2
  exit 1
fi
