import type { HarnessConfig } from "../config.js";
import {
  CloudProvider,
  LlamaServerProvider,
  OllamaProvider,
} from "./openai-compat.js";
import type { Provider } from "./types.js";

export class ProviderRouter {
  private local: Provider;
  private llamaServer: Provider;
  private cloud: Provider | null;

  constructor(private config: HarnessConfig) {
    this.local = new OllamaProvider(config.ollamaBaseUrl, config.ollamaModel);
    this.llamaServer = new LlamaServerProvider(
      config.llamaServerUrl,
      config.llamaServerModel,
    );
    this.cloud = config.openaiApiKey
      ? new CloudProvider(
          config.openaiBaseUrl,
          config.openaiModel,
          config.openaiApiKey,
        )
      : null;
  }

  async resolve(): Promise<Provider> {
    if (this.config.forceCloud && this.cloud) {
      return this.cloud;
    }

    if (this.config.provider === "llama-server") {
      if (await this.llamaServer.healthCheck()) return this.llamaServer;
    } else if (this.config.provider === "openai" && this.cloud) {
      return this.cloud;
    } else if (await this.local.healthCheck()) {
      return this.local;
    }

    if (await this.llamaServer.healthCheck()) return this.llamaServer;
    if (this.cloud && (await this.cloud.healthCheck())) return this.cloud;

    throw new Error(
      "No inference provider available. Start Ollama or llama-server, or set OPENAI_API_KEY.",
    );
  }
}
