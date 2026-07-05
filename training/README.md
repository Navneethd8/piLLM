# training

Pretraining pipeline: Dolma data, tokenizer, model implementation, and export to GGUF.

```
training/
  data/       # Dolma manifests and raw shards (dolma/raw/ gitignored)
  scripts/    # download_dolma.sh, verify_dolma.sh
  docs/       # feasibility and data-acquisition plans
  src/        # model, train, export (future)
```

```bash
cd training
bash scripts/download_dolma.sh
bash scripts/verify_dolma.sh
```
