# harness

Pi inference, evaluation, and tooling — llama.cpp deployment, LangChain.js agents, RAG, and resume-bot UI.

Planned layout (not implemented yet):

```
harness/
  pi/          # llama-server, systemd, GGUF on Pi 3B
  web/         # TypeScript + LangChain.js
  eval/        # benchmarks, parity checks vs training checkpoints
```

See [training/docs/plans/feasibility.md](../training/docs/plans/feasibility.md) for architecture details.
