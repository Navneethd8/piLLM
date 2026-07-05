export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens: number;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  provider: string;
}

export interface Provider {
  name: string;
  healthCheck(): Promise<boolean>;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
