import { PiMonoAgentLoop, type AgentLoop, type ToolCall, type ToolResult } from "../agent-loop/index.js";
import { createSandbox, type CreateSandbox } from "../sandbox/index.js";
import type { McpServerConfig } from "./types.js";

export type McpClientManager = {
  callTool(call: ToolCall): Promise<ToolResult>;
  dispose(): Promise<void>;
};

export type CreateMcpClientManager = (
  servers: readonly McpServerConfig[],
  tokens: Record<string, string>,
) => Promise<McpClientManager | null>;

export type AgentDependencies = {
  createSandbox: CreateSandbox;
  createLoop: () => AgentLoop;
  createMcpClientManager: CreateMcpClientManager;
};

function defaultMcpClientManager(
  servers: readonly McpServerConfig[],
  tokens: Record<string, string>,
): Promise<McpClientManager | null> {
  if (servers.length === 0) {
    return Promise.resolve(null);
  }

  const hasAnyToken = Object.keys(tokens).length > 0;
  return Promise.resolve({
    callTool: async (call) => {
      const tokenHint = hasAnyToken ? "Tokens were provided." : "No MCP tokens were provided.";
      return {
        toolCallId: call.id,
        output: `MCP tool \"${call.name}\" is not available in phase 4. ${tokenHint}`,
        isError: true,
      };
    },
    dispose: async () => Promise.resolve(),
  });
}

export function createDefaultDependencies(): AgentDependencies {
  return {
    createSandbox,
    createLoop: () => new PiMonoAgentLoop(),
    createMcpClientManager: defaultMcpClientManager,
  };
}
