import { PiMonoAgentLoop, type AgentLoop } from "../agent-loop/index.js";
import { createMcpClientManager, type McpClientManager } from "../mcp/index.js";
import type { ObservabilityProvider } from "../observability/types.js";
import { createSandbox, type CreateSandbox } from "../sandbox/index.js";
import type { SandboxIO } from "../sandbox/types.js";
import type { McpServerConfig } from "./types.js";

export type { McpClientManager } from "../mcp/index.js";

export type CreateMcpClientManager = (
  servers: readonly McpServerConfig[],
  tokens: Record<string, string>,
  sandbox?: SandboxIO | null,
) => Promise<McpClientManager | null>;

export type AgentDependencies = {
  createSandbox: CreateSandbox;
  createLoop: () => AgentLoop;
  createMcpClientManager: CreateMcpClientManager;
  observability?: ObservabilityProvider;
};

function defaultCreateMcpClientManager(
  servers: readonly McpServerConfig[],
  tokens: Record<string, string>,
  sandbox?: SandboxIO | null,
): Promise<McpClientManager | null> {
  return createMcpClientManager(servers, tokens, { sandbox: sandbox ?? null });
}

export function createDefaultDependencies(): AgentDependencies {
  return {
    createSandbox,
    createLoop: () => new PiMonoAgentLoop(),
    createMcpClientManager: defaultCreateMcpClientManager,
  };
}
