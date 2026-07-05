import type { ChatRequest, ChatResponse, Provider, ToolCall } from "./types.js";

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

    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${this.name} chat failed (${res.status}): ${text.slice(0, 400)}`);
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
  constructor(baseUrl: string, model: string, timeoutMs?: number) {
    super("ollama", `${baseUrl.replace(/\/$/, "")}/v1`, model, undefined, timeoutMs);
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
