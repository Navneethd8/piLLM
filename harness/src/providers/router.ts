import type { HarnessConfig } from "../config.js";
import { OllamaDualProvider } from "./ollama-dual.js";
import {
  CloudProvider,
  GeminiProvider,
  LlamaServerProvider,
  OllamaProvider,
} from "./openai-compat.js";
import { isRetryableProviderError } from "./errors.js";
import type { ChatRequest, ChatResponse, Provider } from "./types.js";

export class ProviderRouter {
  private local: Provider;
  private llamaServer: Provider;
  private cloud: Provider | null;
  private gemini: Provider | null;

  constructor(private config: HarnessConfig) {
    const timeout = config.inferenceTimeoutMs;
    this.local = config.ollamaDualModel
      ? new OllamaDualProvider(
          config.ollamaBaseUrl,
          config.ollamaChatModel,
          config.ollamaToolModel,
          timeout,
        )
      : new OllamaProvider(config.ollamaBaseUrl, config.ollamaModel, timeout);
    this.llamaServer = new LlamaServerProvider(
      config.llamaServerUrl,
      config.llamaServerModel,
      timeout,
    );
    this.cloud = config.openaiApiKey
      ? new CloudProvider(
          config.openaiBaseUrl,
          config.openaiModel,
          config.openaiApiKey,
          timeout,
        )
      : null;
    this.gemini = config.geminiApiKey
      ? new GeminiProvider(
          config.geminiBaseUrl,
          config.geminiModel,
          config.geminiApiKey,
          timeout,
        )
      : null;
  }

  describeChain(): string {
    switch (this.config.provider) {
      case "openai":
        return this.cloud
          ? `cloud (${this.config.openaiModel})`
          : "cloud (OPENAI_API_KEY not set)";
      case "gemini":
        return this.gemini
          ? `gemini (${this.config.geminiModel})`
          : "gemini (GEMINI_API_KEY not set)";
      case "ollama":
        return this.describeOllama();
      case "llama-server":
        return `llama-server (${this.config.llamaServerModel})`;
      case "cloud-first":
        return this.describeCloudFirstChain();
      case "local-first":
      default:
        return this.describeLocalFirstChain();
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const chain = await this.buildChain();
    if (!chain.length) {
      throw new Error(
        "No inference provider available. Set OPENAI_API_KEY, GEMINI_API_KEY, and/or start Ollama on the Pi.",
      );
    }

    let lastError: Error | undefined;
    for (let i = 0; i < chain.length; i += 1) {
      const provider = chain[i]!;
      const hasFallback = i < chain.length - 1;
      try {
        return await provider.chat(request);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (!hasFallback || !isRetryableProviderError(err)) {
          throw lastError;
        }
        console.warn(
          `[pillm] ${provider.name} failed, falling back: ${lastError.message.slice(0, 160)}`,
        );
      }
    }

    throw lastError ?? new Error("No inference provider available.");
  }

  private describeOllama(): string {
    if (this.config.ollamaDualModel) {
      return `ollama dual (chat: ${this.config.ollamaChatModel}, tool: ${this.config.ollamaToolModel})`;
    }
    return `ollama (${this.config.ollamaModel})`;
  }

  private describeCloudFirstChain(): string {
    const parts: string[] = [];
    if (this.cloud) parts.push(`cloud (${this.config.openaiModel})`);
    if (this.gemini) parts.push(`gemini (${this.config.geminiModel})`);
    parts.push(this.describeOllama());
    return parts.join(" → ");
  }

  private describeLocalFirstChain(): string {
    const parts = [this.describeOllama()];
    if (this.cloud) parts.push(`cloud (${this.config.openaiModel})`);
    if (this.gemini) parts.push(`gemini (${this.config.geminiModel})`);
    return parts.join(" → ");
  }

  private pushCloudProviders(chain: Provider[]): void {
    if (this.cloud) chain.push(this.cloud);
    if (this.gemini) chain.push(this.gemini);
  }

  private async pushLocalProviders(chain: Provider[]): Promise<void> {
    if (await this.local.healthCheck()) chain.push(this.local);
    if (await this.llamaServer.healthCheck()) chain.push(this.llamaServer);
  }

  private async pushHealthyCloudProviders(chain: Provider[]): Promise<void> {
    if (this.cloud && (await this.cloud.healthCheck())) chain.push(this.cloud);
    if (this.gemini && (await this.gemini.healthCheck())) chain.push(this.gemini);
  }

  private async buildChain(): Promise<Provider[]> {
    const chain: Provider[] = [];

    switch (this.config.provider) {
      case "openai":
        if (this.cloud) chain.push(this.cloud);
        break;

      case "gemini":
        if (this.gemini) chain.push(this.gemini);
        break;

      case "ollama":
        if (await this.local.healthCheck()) chain.push(this.local);
        break;

      case "llama-server":
        if (await this.llamaServer.healthCheck()) chain.push(this.llamaServer);
        break;

      case "cloud-first":
        this.pushCloudProviders(chain);
        await this.pushLocalProviders(chain);
        break;

      case "local-first":
      default:
        await this.pushLocalProviders(chain);
        await this.pushHealthyCloudProviders(chain);
        break;
    }

    return chain;
  }
}
