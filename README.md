# piLLM

A from-scratch ~100M-parameter language model for training on Mac M1 / Google Colab and inference on a Raspberry Pi 3B (1GB RAM) via llama.cpp/GGUF.

## Status

- [x] Feasibility and architecture plan
- [x] Dolma v1.7 data manifests and download scripts
- [ ] Model implementation (book-style GPT)
- [ ] Pretrain, export, Pi deployment
- [ ] Resume bot (RAG + LangChain.js + LoRA)

## Plans

- [Feasibility & architecture](docs/plans/feasibility.md) — Pi memory budget, training phases, LangChain.js layout, risks
- [Data acquisition](docs/plans/data-acquisition.md) — Dolma v1.7 slicing, download, verify

## Data

See [data/README.md](data/README.md). Raw shards are not committed (~58 GB); manifests and scripts are.

```bash
bash scripts/download_dolma.sh
bash scripts/verify_dolma.sh
```

## License

Code: TBD. Pretraining data: [Dolma ODC-BY](data/ATTRIBUTION.md).
