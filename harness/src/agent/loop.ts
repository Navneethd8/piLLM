import type { HarnessConfig } from "../config.js";
import { buildSystemPrompt } from "./prompt.js";
import { BUILTIN_TOOLS, getToolMap } from "./tools/index.js";
import { appendMemory, readSkill, writeSkill } from "../memory/files.js";
import { ProviderRouter } from "../providers/router.js";
import type { ChatMessage, ToolCall } from "../providers/types.js";
import { SessionStore } from "../sessions/db.js";

export interface RunTurnOptions {
  sessionId: string;
  userText: string;
  platform?: string;
  history?: ChatMessage[];
  persist?: boolean;
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
  private tools = getToolMap(BUILTIN_TOOLS);
  private sessions: SessionStore;

  constructor(private config: HarnessConfig) {
    this.router = new ProviderRouter(config);
    this.sessions = new SessionStore(config.home);
  }

  async runTurn(opts: RunTurnOptions): Promise<RunTurnResult> {
    const provider = await this.router.resolve();
    const system = buildSystemPrompt(this.config, { platform: opts.platform });
    const history =
      opts.history ??
      (opts.persist !== false ? this.sessions.getMessages(opts.sessionId) : []);

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...history.filter((m) => m.role !== "system"),
      { role: "user", content: opts.userText },
    ];

    if (opts.persist !== false) {
      this.sessions.appendMessage(opts.sessionId, {
        role: "user",
        content: opts.userText,
      });
    }

    let iterations = 0;
    let lastContent = "";

    while (iterations < this.config.maxIterations) {
      iterations += 1;

      const response = await provider.chat({
        messages,
        tools: BUILTIN_TOOLS.map((t) => t.definition),
        maxTokens: this.config.maxTokens,
      });

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
    return { reply: lastContent, provider: provider.name, iterations };
  }

  private async dispatchTool(call: ToolCall): Promise<{ output: string; isError?: boolean }> {
    if (call.name === "skill_manage") {
      return this.handleSkillManage(call.arguments);
    }
    if (call.name === "memory_append") {
      appendMemory(this.config.home, String(call.arguments.note ?? ""));
      return { output: "Memory note appended for next session." };
    }
    if (call.name === "skill_read") {
      const content = readSkill(this.config.home, String(call.arguments.path ?? ""));
      return content
        ? { output: content }
        : { output: "Skill not found", isError: true };
    }

    const tool = this.tools.get(call.name);
    if (!tool) {
      return { output: `Unknown tool: ${call.name}`, isError: true };
    }
    return tool.run(call.arguments, { workspace: this.config.workspace });
  }

  private handleSkillManage(args: Record<string, unknown>): { output: string; isError?: boolean } {
    const category = String(args.category ?? "general");
    const name = String(args.name ?? "untitled");
    const content = String(args.content ?? "");
    if (!content.trim()) {
      return { output: "content required", isError: true };
    }
    const path = writeSkill(this.config.home, category, name, content);
    return { output: `Skill written: ${path}` };
  }

  getSessionStore(): SessionStore {
    return this.sessions;
  }

  close(): void {
    this.sessions.close();
  }
}
