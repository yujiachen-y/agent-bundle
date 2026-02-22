import type { ModelConfig, ResponseEvent, ResponseInput, ToolCall, ToolResult } from "./types.js";

export type ToolHandler = (call: ToolCall) => Promise<ToolResult>;

export type ToolInputSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

export type AgentLoopTool = {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
};

export type AgentLoopConfig = {
  systemPrompt: string;
  model: ModelConfig;
  toolHandler: ToolHandler;
  externalTools?: readonly AgentLoopTool[];
};

export type RunOptions = {
  signal?: AbortSignal;
};

export interface AgentLoop {
  init(config: AgentLoopConfig): Promise<void>;
  run(input: ResponseInput, options?: RunOptions): AsyncIterable<ResponseEvent>;
  dispose(): Promise<void>;
}
