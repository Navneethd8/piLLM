import { ProviderChatError } from "./errors.js";
import {
  isOllamaFetchError,
  unloadAllModels,
  waitUntilUnloaded,
} from "./ollama-utils.js";
import type { ChatRequest, ChatResponse, Provider, ToolCall } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const OLLAMA_FETCH_RETRIES = 2;
const OLLAMA_RETRY_COOLDOWN_MS = 2000;

function isToolsUnsupportedError(err: unknown): boolean {
  return (
    err instanceof ProviderChatError &&
    err.status === 400 &&
    err.message.toLowerCase().includes("does not support tools")
  );
}

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const tc = item as {
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    return {
      id: tc.id ?? `call_${index}`,
      name: tc.function?.name ?? "unknown",
      arguments: args,
    };
  });
}

export class OpenAiCompatProvider implements Provider {
  constructor(
    public name: string,
    private baseUrl: string,
    private model: string,
    private apiKey?: string,
    private timeoutMs = 600_000,
  ) {}

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  protected enrichBody(_body: Record<string, unknown>, _request: ChatRequest): void {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages,
      max_tokens: request.maxTokens,
      stream: false,
    };
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    this.enrichBody(body, request);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderChatError(`${this.name} chat failed: ${message}`, undefined, this.name);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new ProviderChatError(
        `${this.name} chat failed (${res.status}): ${text.slice(0, 400)}`,
        res.status,
        this.name,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: unknown;
        };
      }>;
    };

    const message = data.choices?.[0]?.message;
    return {
      content: message?.content ?? null,
      toolCalls: parseToolCalls(message?.tool_calls),
      provider: this.name,
    };
  }

  private headers(): Record<string, string> {
    if (!this.apiKey) return {};
    return { Authorization: `Bearer ${this.apiKey}` };
  }
}

export class OllamaProvider extends OpenAiCompatProvider {
  private readonly ollamaBaseUrl: string;
  private readonly modelName: string;
  private toolsSupport: boolean | undefined;

  constructor(baseUrl: string, model: string, timeoutMs?: number) {
    super("ollama", `${baseUrl.replace(/\/$/, "")}/v1`, model, undefined, timeoutMs);
    this.ollamaBaseUrl = baseUrl.replace(/\/$/, "");
    this.modelName = model;
  }

  protected override enrichBody(body: Record<string, unknown>, request: ChatRequest): void {
    if (request.contextTokens !== undefined && request.contextTokens > 0) {
      body.options = { num_ctx: request.contextTokens };
    }
  }

  override async chat(request: ChatRequest): Promise<ChatResponse> {
    let req = request;
    if (request.tools?.length && !(await this.modelSupportsTools())) {
      req = { ...request, tools: undefined };
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= OLLAMA_FETCH_RETRIES; attempt += 1) {
      try {
        return await super.chat(req);
      } catch (err) {
        if (request.tools?.length && isToolsUnsupportedError(err)) {
          this.toolsSupport = false;
          return await super.chat({ ...request, tools: undefined });
        }

        lastErr = err;
        if (attempt < OLLAMA_FETCH_RETRIES && isOllamaFetchError(err)) {
          await unloadAllModels(this.ollamaBaseUrl);
          await sleep(OLLAMA_RETRY_COOLDOWN_MS);
          await waitUntilUnloaded(this.ollamaBaseUrl, 15_000);
          continue;
        }
        throw err;
      }
    }

    throw lastErr;
  }

  private async modelSupportsTools(): Promise<boolean> {
    if (this.toolsSupport !== undefined) return this.toolsSupport;
    this.toolsSupport = await this.fetchToolsSupport();
    return this.toolsSupport;
  }

  private async fetchToolsSupport(): Promise<boolean> {
    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.modelName }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return true;
      const data = (await res.json()) as { capabilities?: string[] };
      return data.capabilities?.includes("tools") ?? true;
    } catch {
      return true;
    }
  }
}

export class LlamaServerProvider extends OpenAiCompatProvider {
  constructor(baseUrl: string, model: string, timeoutMs?: number) {
    super("llama-server", baseUrl, model, undefined, timeoutMs);
  }
}

export class CloudProvider extends OpenAiCompatProvider {
  constructor(baseUrl: string, model: string, apiKey: string, timeoutMs?: number) {
    super("cloud", baseUrl, model, apiKey, timeoutMs);
  }
}

export class GeminiProvider extends OpenAiCompatProvider {
  constructor(baseUrl: string, model: string, apiKey: string, timeoutMs?: number) {
    super("gemini", baseUrl, model, apiKey, timeoutMs);
  }
}
