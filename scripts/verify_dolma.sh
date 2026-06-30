#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="${1:-$ROOT/data/manifests/train_100m_v17.txt}"
RAW="$ROOT/data/dolma/raw"

expected="$(wc -l < "$MANIFEST" | tr -d ' ')"
actual="$(find "$RAW" -maxdepth 1 -name '*.json.gz' ! -name '._*' | wc -l | tr -d ' ')"
size="$(du -sh "$RAW" | awk '{print $1}')"

echo "Manifest: $MANIFEST"
echo "Files: $actual / $expected"
echo "Size: $size"

if [[ "$actual" -ne "$expected" ]]; then
  echo "FAIL: file count mismatch" >&2
  exit 1
fi

sample="$(find "$RAW" -maxdepth 1 -name '*.json.gz' ! -name '._*' | head -1)"
echo "Schema sample from $(basename "$sample"):"
gzip -dc "$sample" | head -1 | python3 -m json.tool | head -12 || true
echo "OK"
