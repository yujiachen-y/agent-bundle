import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { AgentLoopTool, ToolCall, ToolResult } from "../agent-loop/index.js";
import type { McpServerConfig } from "../agent/types.js";

const MCP_TOOL_PREFIX = "mcp__";

const CLIENT_INFO = {
  name: "agent-bundle",
  version: "1.0.0",
};

type RemoteCallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type RemoteToolList = Awaited<ReturnType<Client["listTools"]>>["tools"];

type McpConnectionCallResult = {
  output: unknown;
  isError?: boolean;
};

type McpConnection = {
  serverName: string;
  tools: readonly DiscoveredTool[];
  callTool(toolName: string, input: Record<string, unknown>): Promise<McpConnectionCallResult>;
  close(): Promise<void>;
};

type DiscoveredTool = {
  name: string;
  description: string;
  inputSchema: AgentLoopTool["inputSchema"];
};

type ToolRoute = {
  serverName: string;
  toolName: string;
  connection: McpConnection;
};

type Logger = Pick<Console, "warn">;

export type McpClientManager = {
  tools: readonly AgentLoopTool[];
  callTool(call: ToolCall): Promise<ToolResult>;
  dispose(): Promise<void>;
};

export type ConnectMcpServer = (
  server: McpServerConfig,
  token: string | undefined,
) => Promise<McpConnection>;

export type CreateMcpClientManagerOptions = {
  connectServer?: ConnectMcpServer;
  logger?: Logger;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function toDescription(description: unknown): string {
  if (typeof description === "string" && description.trim().length > 0) {
    return description;
  }

  return "MCP tool";
}

function normalizeInputSchema(schema: unknown): AgentLoopTool["inputSchema"] {
  if (!isRecord(schema) || schema.type !== "object") {
    return { type: "object" };
  }

  const normalizedSchema: AgentLoopTool["inputSchema"] = {
    ...schema,
    type: "object",
  };

  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  if (properties) {
    normalizedSchema.properties = properties;
  } else {
    delete normalizedSchema.properties;
  }

  const required = Array.isArray(schema.required)
    && schema.required.every((entry) => typeof entry === "string")
    ? schema.required
    : undefined;
  if (required) {
    normalizedSchema.required = required;
  } else {
    delete normalizedSchema.required;
  }

  return normalizedSchema;
}

function extractTextContent(result: RemoteCallToolResult): string | null {
  if ("toolResult" in result) {
    return null;
  }

  const textBlocks = result.content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .map((text) => text.trim())
    .filter((text) => text.length > 0);

  if (textBlocks.length === 0) {
    return null;
  }

  return textBlocks.join("\n\n");
}

function toToolOutput(result: RemoteCallToolResult): unknown {
  if ("toolResult" in result) {
    return result.toolResult;
  }

  const textOutput = extractTextContent(result);
  if (textOutput !== null) {
    return textOutput;
  }

  if (result.structuredContent) {
    return result.structuredContent;
  }

  return result.content;
}

function isToolCallError(result: RemoteCallToolResult): boolean {
  return !("toolResult" in result) && result.isError === true;
}

async function listAllTools(
  client: Client,
  cursor?: string,
): Promise<RemoteToolList> {
  const page = await client.listTools(cursor ? { cursor } : undefined);
  const next = page.nextCursor ? await listAllTools(client, page.nextCursor) : [];
  return [...page.tools, ...next];
}

function buildToolRouteMap(
  connections: readonly McpConnection[],
  logger: Logger,
): { tools: AgentLoopTool[]; routes: Map<string, ToolRoute> } {
  const routes = new Map<string, ToolRoute>();
  const tools: AgentLoopTool[] = [];

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

function createAuthHeaders(token: string | undefined): HeadersInit | undefined {
  if (!token) {
    return undefined;
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

function toCloseErrorMessage(
  results: readonly PromiseSettledResult<void>[],
): string | null {
  const failures = results
    .flatMap((result) => {
      if (result.status === "fulfilled") {
        return [];
      }
      return [toErrorMessage(result.reason)];
    });

  if (failures.length === 0) {
    return null;
  }

  return failures.join(" | ");
}

async function defaultConnectServer(
  server: McpServerConfig,
  token: string | undefined,
): Promise<McpConnection> {
  const headers = createAuthHeaders(token);
  const requestInit = headers ? { headers } : undefined;
  const transport = new StreamableHTTPClientTransport(
    new URL(server.url),
    requestInit ? { requestInit } : undefined,
  );
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  await client.connect(transport);

  const tools = await listAllTools(client);
  const discoveredTools = tools.map((tool) => ({
    name: tool.name,
    description: toDescription(tool.description),
    inputSchema: normalizeInputSchema(tool.inputSchema),
  }));

  return {
    serverName: server.name,
    tools: discoveredTools,
    callTool: async (toolName, input) => {
      const result = await client.callTool({
        name: toolName,
        arguments: input,
      });

      return {
        output: toToolOutput(result),
        isError: isToolCallError(result),
      };
    },
    close: async () => {
      const closeResults = await Promise.allSettled([
        client.close(),
        transport.close(),
      ]);
      const closeErrorMessage = toCloseErrorMessage(closeResults);
      if (closeErrorMessage) {
        throw new Error(closeErrorMessage);
      }
    },
  };
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
  const connections = await Promise.all(
    servers.map(async (server) => {
      const token = tokens[server.name];
      try {
        return await connectServer(server, token);
      } catch (error) {
        logger.warn(
          `MCP server "${server.name}" at ${server.url} is unreachable: ${toErrorMessage(error)}`,
        );
        return null;
      }
    }),
  );

  const reachableConnections = connections.filter((connection) => connection !== null);
  return createManager(reachableConnections, logger);
}
