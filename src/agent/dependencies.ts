import { PiMonoAgentLoop, type AgentLoop } from "../agent-loop/index.js";
import { createMcpClientManager, type McpClientManager } from "../mcp/index.js";
import { createSandbox, type CreateSandbox } from "../sandbox/index.js";
import type { McpServerConfig } from "./types.js";

export type { McpClientManager } from "../mcp/index.js";

export type CreateMcpClientManager = (
  servers: readonly McpServerConfig[],
  tokens: Record<string, string>,
) => Promise<McpClientManager | null>;

export type AgentDependencies = {
  createSandbox: CreateSandbox;
  createLoop: () => AgentLoop;
  createMcpClientManager: CreateMcpClientManager;
};

function defaultCreateMcpClientManager(
  servers: readonly McpServerConfig[],
  tokens: Record<string, string>,
): Promise<McpClientManager | null> {
  return createMcpClientManager(servers, tokens);
}

export function createDefaultDependencies(): AgentDependencies {
  return {
    createSandbox,
    createLoop: () => new PiMonoAgentLoop(),
    createMcpClientManager: defaultCreateMcpClientManager,
  };
}
