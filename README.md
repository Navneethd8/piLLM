# piLLM

A from-scratch ~100M-parameter language model for training on Mac M1 / Google Colab and inference on a Raspberry Pi 3B (1GB RAM) via llama.cpp/GGUF.

## Layout

```
piLLM/
  training/   # pretrain data, model code, export
  harness/    # Pi inference, LangChain.js, eval
```

## Status

- [x] Feasibility and architecture plan
- [x] Dolma v1.7 data manifests and download scripts
- [x] Edge harness (Ollama/llama-server, web API, Discord gateway)
- [ ] Model implementation (book-style GPT)
- [ ] Pretrain, export, Pi deployment
- [ ] Resume bot (RAG + LangChain.js + LoRA)

## Plans

- [Feasibility & architecture](training/docs/plans/feasibility.md)
- [Data acquisition](training/docs/plans/data-acquisition.md)

## Data

See [training/data/README.md](training/data/README.md). Raw shards are not committed (~58 GB); manifests and scripts are.

```bash
cd training
bash scripts/download_dolma.sh
bash scripts/verify_dolma.sh
```

## License

Code: TBD. Pretraining data: [Dolma ODC-BY](training/data/ATTRIBUTION.md).
