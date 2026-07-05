# harness

Edge-first agent harness for Raspberry Pi — local Ollama/llama-server, web API, Discord gateway.

## Layout

```
harness/
  src/           # TypeScript agent loop, providers, gateway, web
  pi/            # install.sh, systemd units, config.example.env
  data/          # SOUL.md / MEMORY.md templates
  eval/          # benchmarks (future)
```

## Quick start (on Pi)

```bash
cd ~/piLLM/harness
bash pi/install.sh
npm run cli          # interactive chat
npm run gateway      # web :8787 + Discord (if token set)
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run cli` | Interactive terminal agent |
| `npm run serve` | Web API only (`POST /v1/chat`, `GET /health`) |
| `npm run gateway` | Web + Discord |
| `npm run build` | Compile TypeScript |

## Config

Copy [`pi/config.example.env`](pi/config.example.env) to `~/.pillm/.env`.

- **Local default:** Ollama at `127.0.0.1:11434` (e.g. `qwen2.5:0.5b`)
- **Cloud fallback:** set `OPENAI_API_KEY` and `PILLM_FORCE_CLOUD=1`
- **Discord:** set `DISCORD_BOT_TOKEN` + optional allowlists

## Architecture

CLI, web, and Discord are **peer surfaces** into one local agent on the Pi. Inference stays on-device by default.
