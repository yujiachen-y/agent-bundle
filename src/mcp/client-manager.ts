import type { ToolCall, ToolResult } from "../agent-loop/index.js";
import type { McpServerConfig } from "../agent/types.js";
import type { SandboxIO } from "../sandbox/types.js";
import {
  defaultConnectServer,
  toServerLocation,
  type ConnectMcpServer,
  type McpConnection,
} from "./connect-server.js";

const MCP_TOOL_PREFIX = "mcp__";

type ToolRoute = {
  serverName: string;
  toolName: string;
  connection: McpConnection;
};

type Logger = Pick<Console, "warn">;
type ManagerTool = McpClientManager["tools"][number];

export type McpClientManager = {
  tools: readonly {
    name: string;
    description: string;
    inputSchema: {
      type: "object";
      properties?: Record<string, unknown>;
      required?: string[];
      [key: string]: unknown;
    };
  }[];
  callTool(call: ToolCall): Promise<ToolResult>;
  dispose(): Promise<void>;
};

export type CreateMcpClientManagerOptions = {
  connectServer?: ConnectMcpServer;
  logger?: Logger;
  sandbox?: SandboxIO | null;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toToolError(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    output: message,
    isError: true,
  };
}

function toNamespacedToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverName}__${toolName}`;
}

function buildToolRouteMap(
  connections: readonly McpConnection[],
  logger: Logger,
): {
  tools: ManagerTool[];
  routes: Map<string, ToolRoute>;
} {
  const routes = new Map<string, ToolRoute>();
  const tools: ManagerTool[] = [];

  connections.forEach((connection) => {
    connection.tools.forEach((tool) => {
      const namespacedName = toNamespacedToolName(connection.serverName, tool.name);
      if (routes.has(namespacedName)) {
        logger.warn(
          `MCP duplicate tool detected for "${namespacedName}". Keeping the first registration.`,
        );
        return;
      }

      routes.set(namespacedName, {
        serverName: connection.serverName,
        toolName: tool.name,
        connection,
      });
      tools.push({
        name: namespacedName,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    });
  });

  return { tools, routes };
}

function createManager(
  connections: readonly McpConnection[],
  logger: Logger,
): McpClientManager {
  const { tools, routes } = buildToolRouteMap(connections, logger);

  return {
    tools,
    callTool: async (call) => {
      const route = routes.get(call.name);
      if (!route) {
        return toToolError(call.id, `MCP tool "${call.name}" is not available.`);
      }

      try {
        const result = await route.connection.callTool(route.toolName, call.input);
        return {
          toolCallId: call.id,
          output: result.output,
          ...(result.isError ? { isError: true } : {}),
        };
      } catch (error) {
        return toToolError(
          call.id,
          `MCP tool "${call.name}" failed on server "${route.serverName}": ${toErrorMessage(error)}`,
        );
      }
    },
    dispose: async () => {
      const closeResults = await Promise.allSettled(
        connections.map(async (connection) => {
          await connection.close();
        }),
      );
      const failures = closeResults.flatMap((result, index) => {
        if (result.status === "fulfilled") {
          return [];
        }

        const serverName = connections[index]?.serverName ?? "unknown";
        return [`${serverName}: ${toErrorMessage(result.reason)}`];
      });

      if (failures.length > 0) {
        throw new Error(`Failed to close MCP connections: ${failures.join(" | ")}`);
      }
    },
  };
}

export async function createMcpClientManager(
  servers: readonly McpServerConfig[],
  tokens: Record<string, string>,
  options: CreateMcpClientManagerOptions = {},
): Promise<McpClientManager | null> {
  if (servers.length === 0) {
    return null;
  }

  const logger = options.logger ?? console;
  const connectServer = options.connectServer ?? defaultConnectServer;
  const sandbox = options.sandbox ?? null;
  const connections = await Promise.all(
    servers.map(async (server) => {
      const token = tokens[server.name];
      try {
        return await connectServer(server, token, sandbox);
      } catch (error) {
        logger.warn(
          `MCP server "${server.name}" at ${toServerLocation(server)} is unreachable: ${toErrorMessage(error)}`,
        );
        return null;
      }
    }),
  );

  const reachableConnections = connections.filter((connection) => connection !== null);
  return createManager(reachableConnections, logger);
}
