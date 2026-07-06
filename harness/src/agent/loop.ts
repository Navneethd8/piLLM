import type { HarnessConfig } from "../config.js";
import { buildSystemPrompt } from "./prompt.js";
import { getAgentTools } from "./tools/registry.js";
import { getToolMap } from "./tools/index.js";
import { appendMemory } from "../memory/files.js";
import { ProviderRouter } from "../providers/router.js";
import type { ChatMessage, ToolCall } from "../providers/types.js";
import { SessionStore } from "../sessions/db.js";

export interface RunTurnOptions {
  sessionId: string;
  userText: string;
  platform?: string;
  history?: ChatMessage[];
  persist?: boolean;
  skipUserAppend?: boolean;
}

export interface RunTurnResult {
  reply: string;
  provider: string;
  iterations: number;
}


function toAssistantToolMessage(response: { content: string | null; toolCalls: ToolCall[] }): ChatMessage {
  if (response.toolCalls.length === 0) {
    return { role: "assistant", content: response.content ?? "" };
  }
  return {
    role: "assistant",
    content: response.content,
    tool_calls: response.toolCalls.map((c) => ({
      id: c.id,
      type: "function" as const,
      function: {
        name: c.name,
        arguments: JSON.stringify(c.arguments),
      },
    })),
  };
}

export class AgentLoop {
  private router: ProviderRouter;
  private tools: ReturnType<typeof getToolMap>;
  private agentTools: ReturnType<typeof getAgentTools>;
  private sessions: SessionStore;

  constructor(private config: HarnessConfig) {
    this.router = new ProviderRouter(config);
    this.agentTools = getAgentTools(config);
    this.tools = getToolMap(this.agentTools);
    this.sessions = new SessionStore(config.home);
  }

  async runTurn(opts: RunTurnOptions): Promise<RunTurnResult> {
    const system = buildSystemPrompt(this.config, { platform: opts.platform });
    const history =
      opts.history ??
      (opts.persist !== false ? this.sessions.getMessages(opts.sessionId) : []);

    const skipUser = opts.skipUserAppend === true;
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...history.filter((m) => m.role !== "system"),
      ...(skipUser ? [] : [{ role: "user" as const, content: opts.userText }]),
    ];

    if (opts.persist !== false && !skipUser) {
      this.sessions.appendMessage(opts.sessionId, {
        role: "user",
        content: opts.userText,
      });
    }

    let iterations = 0;
    let lastContent = "";
    let lastProvider = "unknown";

    while (iterations < this.config.maxIterations) {
      iterations += 1;

      const response = await this.router.chat({
        messages,
        tools: this.agentTools.map((t) => t.definition),
        maxTokens: this.config.maxTokens,
      });
      lastProvider = response.provider;

      if (response.toolCalls.length === 0) {
        lastContent = response.content?.trim() || "(empty response)";
        messages.push({ role: "assistant", content: lastContent });
        if (opts.persist !== false) {
          this.sessions.appendMessage(opts.sessionId, {
            role: "assistant",
            content: lastContent,
          });
        }
        return { reply: lastContent, provider: response.provider, iterations };
      }

      messages.push(toAssistantToolMessage(response));

      for (const call of response.toolCalls) {
        const result = await this.dispatchTool(call);
        const toolMessage: ChatMessage = {
          role: "tool",
          content: result.output,
          tool_call_id: call.id,
          name: call.name,
        };
        messages.push(toolMessage);
        if (opts.persist !== false) {
          this.sessions.appendMessage(opts.sessionId, toolMessage);
        }
      }
    }

    lastContent =
      "Iteration budget exhausted. Try a simpler request or increase PILLM_MAX_ITERATIONS.";
    if (opts.persist !== false) {
      this.sessions.appendMessage(opts.sessionId, {
        role: "assistant",
        content: lastContent,
      });
    }
    return { reply: lastContent, provider: lastProvider, iterations };
  }

  private async dispatchTool(call: ToolCall): Promise<{ output: string; isError?: boolean }> {
    if (call.name === "memory_append") {
      appendMemory(this.config.home, String(call.arguments.note ?? ""));
      return { output: "Memory note appended for next session." };
    }

    const tool = this.tools.get(call.name);
    if (!tool) {
      return { output: `Unknown tool: ${call.name}`, isError: true };
    }
    try {
      return await tool.run(call.arguments, { workspace: this.config.workspace });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `Tool error (${call.name}): ${msg}`, isError: true };
    }
  }

  getSessionStore(): SessionStore {
    return this.sessions;
  }

  close(): void {
    this.sessions.close();
  }
}
