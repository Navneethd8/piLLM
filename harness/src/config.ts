import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

export type ProviderKind =
  | "cloud-first"
  | "local-first"
  | "ollama"
  | "llama-server"
  | "openai"
  | "gemini";

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
  geminiBaseUrl: string;
  geminiModel: string;
  geminiApiKey: string | undefined;
  webHost: string;
  webPort: number;
  maxIterations: number;
  maxTokens: number;
  contextTokens: number;
  discordBotToken: string | undefined;
  discordAllowedGuildIds: string[];
  discordAllowedUserIds: string[];
  discordAutoThread: boolean;
  discordThreadRequireMention: boolean;
  discordNoThreadChannels: string[];
  skillsEnabled: boolean;
  maxSkills: number;
  maxSkillBytes: number;
  inferenceTimeoutMs: number;
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

function geminiApiKeyFromEnv(): string | undefined {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || undefined;
}

function resolveProviderKind(): ProviderKind {
  const raw = process.env.PILLM_PROVIDER?.trim().toLowerCase();
  if (raw === "cloud-first" || raw === "cloud_first") return "cloud-first";
  if (raw === "local-first" || raw === "local_first") return "local-first";
  if (raw === "openai" || raw === "cloud") return "openai";
  if (raw === "gemini" || raw === "google") return "gemini";
  if (raw === "ollama" || raw === "local") return "ollama";
  if (raw === "llama-server" || raw === "llama_server") return "llama-server";

  if (process.env.PILLM_FORCE_CLOUD === "1") {
    if (process.env.OPENAI_API_KEY?.trim()) return "openai";
    if (geminiApiKeyFromEnv()) return "gemini";
    return "openai";
  }
  if (process.env.OPENAI_API_KEY?.trim() || geminiApiKeyFromEnv()) return "cloud-first";
  return "local-first";
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

  const provider = resolveProviderKind();

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
    geminiBaseUrl:
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    geminiApiKey: geminiApiKeyFromEnv(),
    webHost: process.env.PILLM_WEB_HOST ?? "127.0.0.1",
    webPort: envInt("PILLM_WEB_PORT", 8787),
    maxIterations: envInt("PILLM_MAX_ITERATIONS", 8),
    maxTokens: envInt("PILLM_MAX_TOKENS", 256),
    contextTokens: envInt("PILLM_CONTEXT_TOKENS", 2048),
    discordBotToken: process.env.DISCORD_BOT_TOKEN,
    discordAllowedGuildIds: envList("DISCORD_ALLOWED_GUILD_IDS"),
    discordAllowedUserIds: envList("DISCORD_ALLOWED_USER_IDS"),
    discordAutoThread: process.env.DISCORD_AUTO_THREAD !== "0",
    discordThreadRequireMention: process.env.DISCORD_THREAD_REQUIRE_MENTION === "1",
    discordNoThreadChannels: envList("DISCORD_NO_THREAD_CHANNELS"),
    skillsEnabled: process.env.PILLM_SKILLS === "1",
    maxSkills: envInt("PILLM_MAX_SKILLS", 20),
    maxSkillBytes: envInt("PILLM_MAX_SKILL_BYTES", 4096),
    inferenceTimeoutMs: envInt("PILLM_INFERENCE_TIMEOUT_MS", 600_000),
  };
}

export function readContextFile(workspace: string, name: string): string | undefined {
  const path = join(workspace, name);
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").trim() || undefined;
}
