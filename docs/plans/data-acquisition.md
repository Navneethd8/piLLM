---
name: piLLM Data Acquisition
overview: Download Dolma v1_7 raw slice sized for 124M pretrain (~0.5–2B tokens) into piLLM/data/dolma/raw/. No smoke test. Tokenization, resume, RAG deferred.
todos:
  - id: data-dirs-gitignore
    content: Create data/manifests/, data/dolma/raw/, data/.gitignore, ATTRIBUTION.md
    status: pending
  - id: data-manifests
    content: Clone dolma urls; write train_124m_v17.txt (~121 shards); record counts in download_meta.json
    status: pending
  - id: data-download
    content: Add scripts/download_dolma.sh; wget train_124m_v17.txt into data/dolma/raw/ (~15–40 GB)
    status: completed
  - id: data-verify
    content: Verify shard count matches manifest; spot-check JSONL schema and source field values
    status: completed
isProject: false
---

# Subplan: raw Dolma v1_7 download (124M pretrain slice)

Parent plan: [piLLM Feasibility Plan](feasibility.md)

**Scope now:** download the **100M pretrain raw slice** (`train_100m_v17.txt`, 25 shards, ~63 GB). The 121-shard `train_124m_v17.txt` manifest is kept for reference but not used.

**Target:** ~**25 shards**, ~**63 GB** gzip on disk → enough raw text for **0.5–1.5B tokens** after tokenization.

**Deferred:** BPE tokenizer, `.bin` shards, resume, RAG, LoRA.

---

## Target layout

```
piLLM/data/
├── .gitignore
├── ATTRIBUTION.md
├── manifests/
│   ├── train_124m_v17.txt    # wget URL list
│   └── download_meta.json
└── dolma/
    └── raw/                  # *.json.gz (gitignored)
```

---

## Manifest composition (`train_124m_v17.txt`)

Built from [`urls/v1_7.txt`](https://huggingface.co/datasets/allenai/dolma/blob/main/urls/v1_7.txt). v1_7 has **no official sample** — this manifest is the slice.

| Source (v1_7 path) | Shards in manifest | Available in v1_7 | Rationale |
|--------------------|-------------------|-------------------|-----------|
| `wiki/` | **all (2)** | 2 | Clean encyclopedic prose |
| `books/` | **all (3)** | 3 | Gutenberg books |
| `pes2o/` | **all (26)** | 26 | STEM papers |
| `c4-filtered/` | **first 50** | 171 | Filtered web text |
| `starcoder/` | **first 10** | 49 | Code breadth |
| `cc_en_head/` | **first 30** | 275 | Higher-quality Common Crawl tier |
| **Total** | **~121** | — | Skip reddit, flan, refinedweb bulk early |

Skip for now: `reddit/`, `falcon-refinedweb-filtered/` (500 shards), `tulu_flan/`, `cc_en_middle|tail/`.

### Build commands

```bash
cd /Volumes/NewVolume/piLLM
mkdir -p data/manifests data/dolma/raw

git clone --depth 1 https://huggingface.co/datasets/allenai/dolma data/.cache/dolma-urls

MANIFEST=data/manifests/train_124m_v17.txt
URLS=data/.cache/dolma-urls/urls/v1_7.txt

grep -E 'dolma-v1_7/(wiki|books)/' "$URLS" > "$MANIFEST"
grep 'dolma-v1_7/pes2o/' "$URLS" >> "$MANIFEST"          # all 26
grep 'dolma-v1_7/c4-filtered/' "$URLS" | head -50 >> "$MANIFEST"
grep 'dolma-v1_7/starcoder/' "$URLS" | head -10 >> "$MANIFEST"
grep 'dolma-v1_7/cc_en_head/' "$URLS" | head -30 >> "$MANIFEST"

wc -l "$MANIFEST"   # expect 121
```

### `download_meta.json`

```json
{
  "dolma_version": "v1_7",
  "manifest": "train_124m_v17.txt",
  "target_model": "124M",
  "expected_tokens_after_tokenize": "0.5B-2B",
  "shard_count": 121,
  "sources": {
    "wiki": "all",
    "books": "all",
    "pes2o": "all",
    "c4-filtered": 50,
    "starcoder": 10,
    "cc_en_head": 30
  },
  "created": "2026-06-28"
}
```

---

## Download

[`scripts/download_dolma.sh`](piLLM/scripts/download_dolma.sh):

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="${1:-$ROOT/data/manifests/train_124m_v17.txt}"
OUT="$ROOT/data/dolma/raw"
mkdir -p "$OUT"
cat "$MANIFEST" | xargs -n 1 -P 4 wget -c -q -P "$OUT"
echo "Done: $(ls "$OUT"/*.json.gz 2>/dev/null | wc -l) / $(wc -l < "$MANIFEST") files"
```

```bash
bash scripts/download_dolma.sh
```

- `-c` resumes interrupted downloads (important — **hours** on typical home internet)
- `-P 4` parallel jobs; reduce to 2 if bandwidth-saturated
- **Disk:** ensure **≥50 GB free** on `/Volumes/NewVolume` before starting

**Colab:** mount Drive to `data/dolma/raw`, run same script; or download on M1 and rsync once.

---

## Verify

```bash
test "$(wc -l < data/manifests/train_124m_v17.txt)" -eq "$(ls data/dolma/raw/*.json.gz | wc -l)"

zcat data/dolma/raw/*.json.gz | head -1 | python3 -m json.tool
# keys: id, text, source, added, created

# optional: source distribution across one shard
zcat data/dolma/raw/pes2o-0000.json.gz | python3 -c "
import sys, json, collections
print(collections.Counter(json.loads(l)['source'] for l in sys.stdin).most_common(10))
"
```

---

## `data/.gitignore`

```
dolma/raw/
.cache/
```

`data/ATTRIBUTION.md`: cite [Dolma v1.7](https://huggingface.co/datasets/allenai/dolma) (ODC-BY).

---

## Exit criteria

- [ ] 121 `.json.gz` files in `data/dolma/raw/` matching `train_124m_v17.txt`
- [ ] Total raw size roughly 15–40 GB (varies by shard)
- [ ] JSONL schema validated
- [ ] `download_meta.json` + `ATTRIBUTION.md` committed; `dolma/raw/` gitignored

---

## Later (not this subplan)

| When | What |
|------|------|
| Before pretrain | Train BPE on this raw slice; tokenize to `.bin` with 0.5–2B token budget |
| Need more data | Append `cc_en_head` shards 31–80 or `c4-filtered` 51–100 to manifest, re-wget |
| Resume bot | `data/resume/`, RAG, LoRA data |
