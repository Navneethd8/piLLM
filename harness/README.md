# harness

Edge-first agent harness for Raspberry Pi — local Ollama, web API, Discord gateway.

## Layout

```
harness/
  src/           # TypeScript agent loop, providers, gateway, web
  pi/            # install.sh, benchmark.sh, systemd units, config.example.env
  eval/          # model benchmark cases + candidate model list
  data/          # SOUL.md / MEMORY.md templates
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
| `npm run benchmark` | Score local Ollama models (accuracy, latency, tok/s) |
| `npm run build` | Compile TypeScript |

## Production model (Pi)

**`qwen2.5:0.5b`** via Ollama — benchmark winner on Pi 3B 1GB with models on USB.

```bash
# On the Pi — store models on USB (keeps SD card free)
OLLAMA_USB_PATH=/mnt/sda bash pi/setup-ollama-usb.sh
ollama pull qwen2.5:0.5b
```

Set in `~/.pillm/.env`:

```
PILLM_PROVIDER=local-first   # or ollama for local-only
OLLAMA_MODEL=qwen2.5:0.5b
OLLAMA_MODELS=/mnt/sda/ollama-models
```

## Model benchmark (Pi)

Re-run scoring on candidate models listed in [`eval/models.json`](eval/models.json):

```bash
cd ~/piLLM/harness
OLLAMA_USB_PATH=/mnt/sda bash pi/benchmark.sh
```

What it does:

1. Points `OLLAMA_MODELS` at `<usb>/ollama-models` (via `pi/setup-ollama-usb.sh`)
2. Pulls candidates from `eval/models.json`
3. Runs 6 fixed tasks: math, logic, instructions, JSON, summarization, agent-style reply
4. Scores each model on **accuracy**, **TTFT**, **total latency**, **tok/s**, and **reliability**
5. **Unloads each model before loading the next** (`keep_alive: 0`, `OLLAMA_MAX_LOADED_MODELS=1`) so 1GB Pi doesn't OOM
6. Writes `~/.pillm/benchmarks/latest.json` and updates `OLLAMA_MODEL` to the winner

Re-run without pulling:

```bash
npm run benchmark
```

## Config

Copy [`pi/config.example.env`](pi/config.example.env) to `~/.pillm/.env`.

- **Cloud-first default:** set `OPENAI_API_KEY` and/or `GEMINI_API_KEY` — tries cloud providers in order, falls back to Ollama on rate limits/errors
- **Gemini only:** `PILLM_PROVIDER=gemini` with `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- **Local-first (production):** `PILLM_PROVIDER=local-first` with `OLLAMA_MODEL=qwen2.5:0.5b`
- **Dual Ollama (chat + tools):** set `OLLAMA_CHAT_MODEL`, `OLLAMA_TOOL_MODEL`, and `PILLM_OLLAMA_DUAL=1` — routes casual chat to the fast model and tool-ish requests to a tool-capable model
- **Local-only:** `PILLM_PROVIDER=ollama`
- **USB model storage:** `OLLAMA_MODELS=/mnt/sda/ollama-models` (or run `pi/setup-ollama-usb.sh`)
- **Discord:** set `DISCORD_BOT_TOKEN` + optional allowlists

Cloud-first chain when both keys are set: OpenAI → Gemini → Ollama.

## Architecture

CLI, web, and Discord are **peer surfaces** into one agent. With cloud API keys set, inference uses cloud-first (OpenAI, then Gemini) and falls back to local Ollama on rate limits or errors.
