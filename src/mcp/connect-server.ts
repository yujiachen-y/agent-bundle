import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { AgentLoopTool } from "../agent-loop/index.js";
import type { McpServerConfig } from "../agent/types.js";
import type { SandboxIO } from "../sandbox/types.js";
import { SandboxStdioTransport } from "./sandbox-stdio-transport.js";
import { toErrorMessage, isRecord } from "../shared/errors.js";

const CLIENT_INFO = {
  name: "agent-bundle",
  version: "1.0.0",
};

type RemoteCallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type RemoteToolList = Awaited<ReturnType<Client["listTools"]>>["tools"];

export type McpConnectionCallResult = {
  output: unknown;
  isError?: boolean;
};

export type DiscoveredTool = {
  name: string;
  description: string;
  inputSchema: AgentLoopTool["inputSchema"];
};

export type McpConnection = {
  serverName: string;
  tools: readonly DiscoveredTool[];
  callTool(toolName: string, input: Record<string, unknown>): Promise<McpConnectionCallResult>;
  close(): Promise<void>;
};

export type ConnectMcpServer = (
  server: McpServerConfig,
  token: string | undefined,
  sandbox: SandboxIO | null,
) => Promise<McpConnection>;

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

async function listAllTools(client: Client, cursor?: string): Promise<RemoteToolList> {
  const tools: RemoteToolList = [];
  let nextCursor = cursor;
  let pages = 0;
  const MAX_PAGES = 100;
  do {
    const page = await client.listTools(nextCursor ? { cursor: nextCursor } : undefined);
    tools.push(...page.tools);
    nextCursor = page.nextCursor;
    pages++;
  } while (nextCursor && pages < MAX_PAGES);
  return tools;
}

function createAuthHeaders(token: string | undefined): HeadersInit | undefined {
  if (!token) {
    return undefined;
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

function toCloseErrorMessage(results: readonly PromiseSettledResult<void>[]): string | null {
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

async function createConnectionFromTransport(
  serverName: string,
  transport: Transport,
): Promise<McpConnection> {
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  client.onerror = (error) => {
    console.error(`[mcp] ${serverName} transport error:`, error);
  };
  await client.connect(transport);

  const tools = await listAllTools(client);
  const discoveredTools = tools.map((tool) => ({
    name: tool.name,
    description: toDescription(tool.description),
    inputSchema: normalizeInputSchema(tool.inputSchema),
  }));

  return {
    serverName,
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

export function toServerLocation(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    return `${server.command} ${server.args?.join(" ") ?? ""}`.trim();
  }

  return server.url;
}

export async function defaultConnectServer(
  server: McpServerConfig,
  token: string | undefined,
  sandbox: SandboxIO | null,
): Promise<McpConnection> {
  if (server.transport === "http") {
    const headers = createAuthHeaders(token);
    const requestInit = headers ? { headers } : undefined;
    const transport = new StreamableHTTPClientTransport(
      new URL(server.url),
      requestInit ? { requestInit } : undefined,
    );
    return await createConnectionFromTransport(server.name, transport);
  }

  if (server.transport === "stdio") {
    if (!sandbox) {
      throw new Error(`stdio MCP server "${server.name}" requires a sandbox`);
    }

    const transport = new SandboxStdioTransport({
      sandbox,
      command: server.command,
      args: server.args,
      env: server.env,
    });
    return await createConnectionFromTransport(server.name, transport);
  }

  const headers = server.auth === "bearer" ? createAuthHeaders(token) : undefined;
  const requestInit = headers ? { headers } : undefined;
  const transport = new SSEClientTransport(
    new URL(server.url),
    requestInit ? { requestInit } : undefined,
  );
  return await createConnectionFromTransport(server.name, transport);
}
