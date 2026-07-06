import type { ChatMessage, ToolDefinition } from "../providers/types.js";

/** Rough token estimate (chars / 4). Good enough for Pi context budgeting. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessageTokens(msg: ChatMessage): number {
  let tokens = 4;
  if (msg.content) tokens += estimateTokens(msg.content);
  if (msg.tool_calls?.length) {
    tokens += estimateTokens(JSON.stringify(msg.tool_calls));
  }
  if (msg.name) tokens += estimateTokens(msg.name);
  return tokens;
}

export function estimateToolsTokens(tools: ToolDefinition[]): number {
  if (!tools.length) return 0;
  return estimateTokens(JSON.stringify(tools)) + 16;
}

export interface TruncateOptions {
  contextTokens: number;
  maxTokens: number;
  tools?: ToolDefinition[];
}

/** Keep system messages and the most recent turns that fit the context budget. */
export function truncateMessages(
  messages: ChatMessage[],
  opts: TruncateOptions,
): ChatMessage[] {
  const toolsBudget = estimateToolsTokens(opts.tools ?? []);
  const budget =
    opts.contextTokens - opts.maxTokens - toolsBudget - 32;

  const system = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  if (budget <= 0) {
    console.warn(
      `[pillm] context budget exhausted by reserves (context=${opts.contextTokens}); sending system only`,
    );
    return system;
  }

  const systemTokens = system.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  let remaining = budget - systemTokens;

  if (remaining <= 0) {
    console.warn(
      `[pillm] system prompt (~${systemTokens} est. tokens) exceeds message budget; sending system only`,
    );
    return system;
  }

  const kept: ChatMessage[] = [];
  for (let i = nonSystem.length - 1; i >= 0; i -= 1) {
    const msg = nonSystem[i]!;
    const msgTokens = estimateMessageTokens(msg);
    if (msgTokens <= remaining) {
      kept.unshift(msg);
      remaining -= msgTokens;
    } else {
      break;
    }
  }

  while (kept.length > 0 && kept[0]!.role === "tool") {
    kept.shift();
  }

  const dropped = nonSystem.length - kept.length;
  if (dropped > 0) {
    console.warn(
      `[pillm] truncated ${dropped} message(s) to fit context (budget=${opts.contextTokens}, kept=${system.length + kept.length}/${messages.length})`,
    );
  }

  return [...system, ...kept];
}
