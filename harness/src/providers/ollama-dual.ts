import { OllamaProvider } from "./openai-compat.js";
import { prepareModelSwitch } from "./ollama-utils.js";
import type { ChatRequest, ChatResponse, Provider } from "./types.js";

const TOOL_INTENT =
  /\b(read|write|edit|bash|run|execute|file|skill|workspace|command|shell|script|list files|show me|grep|cat |ls )\b|\.md|\.ts|\.sh/i;

export function needsToolModel(request: ChatRequest): boolean {
  if (
    request.messages.some(
      (m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0,
    )
  ) {
    return true;
  }

  for (const msg of request.messages) {
    if (msg.role === "user" && msg.content && TOOL_INTENT.test(msg.content)) {
      return true;
    }
  }

  return false;
}

type Route = "chat" | "tool";

export class OllamaDualProvider implements Provider {
  readonly name = "ollama-dual";
  private readonly baseUrl: string;
  private readonly chatProvider: OllamaProvider;
  private readonly toolProvider: OllamaProvider;
  readonly chatModel: string;
  readonly toolModel: string;
  private lastRoute: Route | null = null;

  constructor(
    baseUrl: string,
    chatModel: string,
    toolModel: string,
    timeoutMs: number,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.chatModel = chatModel;
    this.toolModel = toolModel;
    this.chatProvider = new OllamaProvider(this.baseUrl, chatModel, timeoutMs);
    this.toolProvider = new OllamaProvider(this.baseUrl, toolModel, timeoutMs);
  }

  async healthCheck(): Promise<boolean> {
    return (await this.chatProvider.healthCheck()) && (await this.toolProvider.healthCheck());
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const useTool = needsToolModel(request);
    const route: Route = useTool ? "tool" : "chat";

    if (this.lastRoute !== null && this.lastRoute !== route) {
      const fromModel = this.lastRoute === "chat" ? this.chatModel : this.toolModel;
      await prepareModelSwitch(this.baseUrl, fromModel);
    }

    this.lastRoute = route;

    const provider = useTool ? this.toolProvider : this.chatProvider;
    const routed = useTool ? request : { ...request, tools: undefined };
    const response = await provider.chat(routed);
    return {
      ...response,
      provider: useTool
        ? `ollama-tool (${this.toolModel})`
        : `ollama-chat (${this.chatModel})`,
    };
  }
}
