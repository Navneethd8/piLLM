import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

export type ProviderKind = "ollama" | "llama-server" | "openai";

export interface HarnessConfig {
  home: string;
  workspace: string;
  provider: ProviderKind;
  ollamaBaseUrl: string;
  ollamaModel: string;
  llamaServerUrl: string;
  llamaServerModel: string;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKey: string | undefined;
  forceCloud: boolean;
  webHost: string;
  webPort: number;
  maxIterations: number;
  maxTokens: number;
  contextTokens: number;
  discordBotToken: string | undefined;
  discordAllowedGuildIds: string[];
  discordAllowedUserIds: string[];
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envList(name: string): string[] {
  const raw = process.env[name];
  if (!raw?.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(): HarnessConfig {
  const home = process.env.PILLM_HOME ?? join(homedir(), ".pillm");
  const envPath = join(home, ".env");
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
  loadDotenv();

  const workspace =
    process.env.PILLM_WORKSPACE ??
    resolve(process.cwd());

  const provider = (process.env.PILLM_PROVIDER ?? "ollama") as ProviderKind;

  return {
    home,
    workspace,
    provider,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    ollamaModel: process.env.OLLAMA_MODEL ?? "qwen2.5:0.5b",
    llamaServerUrl: process.env.LLAMA_SERVER_URL ?? "http://127.0.0.1:8080/v1",
    llamaServerModel: process.env.LLAMA_SERVER_MODEL ?? "pillm-100m",
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    openaiApiKey: process.env.OPENAI_API_KEY,
    forceCloud: process.env.PILLM_FORCE_CLOUD === "1",
    webHost: process.env.PILLM_WEB_HOST ?? "127.0.0.1",
    webPort: envInt("PILLM_WEB_PORT", 8787),
    maxIterations: envInt("PILLM_MAX_ITERATIONS", 8),
    maxTokens: envInt("PILLM_MAX_TOKENS", 256),
    contextTokens: envInt("PILLM_CONTEXT_TOKENS", 2048),
    discordBotToken: process.env.DISCORD_BOT_TOKEN,
    discordAllowedGuildIds: envList("DISCORD_ALLOWED_GUILD_IDS"),
    discordAllowedUserIds: envList("DISCORD_ALLOWED_USER_IDS"),
  };
}

export function readContextFile(workspace: string, name: string): string | undefined {
  const path = join(workspace, name);
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").trim() || undefined;
}
