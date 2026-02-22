import type {
  ModelConfig,
  ResponseEvent,
  ResponseInput,
  ResponseOutput,
} from "../agent-loop/types.js";
import type { SandboxConfig, SandboxHooks } from "../sandbox/types.js";
import type { SessionState } from "./session.js";

export type McpServerConfig = {
  name: string;
  url: string;
  auth: "bearer";
};

export type AgentStatus = "ready" | "running" | "stopped";

export interface Agent {
  readonly name: string;
  readonly status: AgentStatus;

  respond(input: ResponseInput): Promise<ResponseOutput>;
  respondStream(input: ResponseInput): AsyncIterable<ResponseEvent>;
  shutdown(): Promise<void>;
}

export type InitOptions<V extends string> = {
  variables: Record<V, string>;
  hooks?: SandboxHooks;
  session?: SessionState;
  mcpTokens?: Record<string, string>;
};

export type AgentConfig<V extends string> = {
  name: string;
  sandbox: SandboxConfig;
  model: ModelConfig;
  systemPrompt: string;
  variables: readonly V[];
  mcp?: McpServerConfig[];
};

export type AgentFactory<V extends string> = {
  name: string;
  init(options: InitOptions<V>): Promise<Agent>;
};
