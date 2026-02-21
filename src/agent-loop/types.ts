export type ModelProvider =
  | "anthropic"
  | "openai"
  | "gemini"
  | "ollama"
  | "openrouter";

export type ModelConfig = {
  provider: ModelProvider;
  model: string;
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResult = {
  toolCallId: string;
  output: unknown;
  isError?: boolean;
};

export type ResponseInputMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string;
      tool_calls?: ToolCall[];
    }
  | {
      role: "tool";
      content: string;
      tool_results: ToolResult[];
    };

export type ResponseInput = ResponseInputMessage[];

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ResponseOutput = {
  id: string;
  output: string;
  usage?: TokenUsage;
};

export type ResponseCreatedEvent = {
  type: "response.created";
  responseId: string;
};

export type ResponseOutputTextDeltaEvent = {
  type: "response.output_text.delta";
  delta: string;
};

export type ResponseOutputTextDoneEvent = {
  type: "response.output_text.done";
  text: string;
};

export type ResponseToolCallCreatedEvent = {
  type: "response.tool_call.created";
  toolCall: ToolCall;
};

export type ResponseToolCallDoneEvent = {
  type: "response.tool_call.done";
  result: ToolResult;
};

export type ToolExecutionUpdateEvent = {
  type: "tool_execution_update";
  toolCallId: string;
  chunk: string;
};

export type ResponseCompletedEvent = {
  type: "response.completed";
  output: ResponseOutput;
};

export type ResponseErrorEvent = {
  type: "response.error";
  error: string;
};

export type ResponseEvent =
  | ResponseCreatedEvent
  | ResponseOutputTextDeltaEvent
  | ResponseOutputTextDoneEvent
  | ResponseToolCallCreatedEvent
  | ResponseToolCallDoneEvent
  | ToolExecutionUpdateEvent
  | ResponseCompletedEvent
  | ResponseErrorEvent;
