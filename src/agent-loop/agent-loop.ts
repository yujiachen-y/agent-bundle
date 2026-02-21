import type { ModelConfig, ResponseEvent, ResponseInput, ToolCall, ToolResult } from "./types.js";

export type ToolHandler = (call: ToolCall) => Promise<ToolResult>;

export type AgentLoopConfig = {
  systemPrompt: string;
  model: ModelConfig;
  toolHandler: ToolHandler;
};

export interface AgentLoop {
  init(config: AgentLoopConfig): Promise<void>;
  run(input: ResponseInput): AsyncIterable<ResponseEvent>;
  dispose(): Promise<void>;
}
