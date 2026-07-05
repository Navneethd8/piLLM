# piLLM data

Raw Dolma v1.7 pretrain slice for a **~100M** parameter model.

## Layout

- `manifests/train_100m_v17.txt` — 25 shard URLs (~63 GB)
- `manifests/train_124m_v17.txt` — previous 121-shard manifest (315 GB, not used)
- `manifests/download_meta.json` — active slice metadata
- `dolma/raw/` — downloaded `*.json.gz` shards (gitignored)

## Download

```bash
cd training   # or run from repo root with training/ prefix
bash scripts/download_dolma.sh
```

Default manifest: `train_100m_v17.txt`. Override: `bash scripts/download_dolma.sh data/manifests/other.txt`

Resumes partial downloads (`curl -C -`).

## Verify

```bash
bash scripts/verify_dolma.sh
```

## Shard format

Gzip JSONL — one document per line (`id`, `text`, `source`, …):

```bash
gzip -dc data/dolma/raw/books-0000.json.gz | head -1 | python3 -m json.tool
```
