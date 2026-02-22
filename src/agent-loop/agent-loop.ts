import type { ModelConfig, ResponseEvent, ResponseInput, ToolCall, ToolResult } from "./types.js";

export type ToolHandler = (call: ToolCall) => Promise<ToolResult>;

export type AgentLoopConfig = {
  systemPrompt: string;
  model: ModelConfig;
  toolHandler: ToolHandler;
};

export type RunOptions = {
  signal?: AbortSignal;
};

export interface AgentLoop {
  init(config: AgentLoopConfig): Promise<void>;
  run(input: ResponseInput, options?: RunOptions): AsyncIterable<ResponseEvent>;
  dispose(): Promise<void>;
}
