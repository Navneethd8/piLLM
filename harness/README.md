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

- **Cloud-first default:** set `OPENAI_API_KEY` and/or `GEMINI_API_KEY` — tries cloud providers in order, falls back to Ollama on rate limits/errors
- **Gemini only:** `PILLM_PROVIDER=gemini` with `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- **Local-only:** `PILLM_PROVIDER=ollama` (or omit cloud API keys)
- **Discord:** set `DISCORD_BOT_TOKEN` + optional allowlists

Cloud-first chain when both keys are set: OpenAI → Gemini → Ollama → llama-server (if running).

## Architecture

CLI, web, and Discord are **peer surfaces** into one agent. With cloud API keys set, inference uses cloud-first (OpenAI, then Gemini) and falls back to local Ollama on rate limits or errors.
