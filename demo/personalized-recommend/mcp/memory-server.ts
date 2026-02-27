import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const EXPECTED_BEARER_TOKEN = "demo";
export const MEMORY_SERVER_PORT = 3101;

type MemoryProfile = Record<string, unknown>;
type SessionEntry = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};
type StartedMemoryServer = {
  port: number;
  close: () => Promise<void>;
};

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
    return value[0];
  }
  return null;
}

function isAuthorized(request: IncomingMessage): boolean {
  const authorization = getHeaderValue(request.headers.authorization);
  return authorization === `Bearer ${EXPECTED_BEARER_TOKEN}`;
}

function toJsonRpcErrorBody(message: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message,
    },
    id: null,
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return undefined;
  }

  return JSON.parse(raw);
}

function createMemoryMcpServer(memoryByUser: Map<string, MemoryProfile>): McpServer {
  const server = new McpServer({
    name: "demo-memory-server",
    version: "1.0.0",
  });

  server.registerTool(
    "memory_read",
    {
      description: "Read a user profile from memory.",
      inputSchema: {
        userId: z.string().min(1),
      },
    },
    async ({ userId }) => {
      const profile = memoryByUser.get(userId) ?? {};
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ userId, profile }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "memory_write",
    {
      description: "Write a merged user profile to memory.",
      inputSchema: {
        userId: z.string().min(1),
        profile: z.record(z.string(), z.unknown()),
      },
    },
    async ({ userId, profile }) => {
      const existing = memoryByUser.get(userId) ?? {};
      const nextProfile = {
        ...existing,
        ...profile,
        updatedAt: new Date().toISOString(),
      };
      memoryByUser.set(userId, nextProfile);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, userId, profile: nextProfile }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "memory_list",
    {
      description: "List all user ids currently stored in memory.",
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              users: [...memoryByUser.keys()].sort(),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "memory_persist",
    {
      description: "Return a snapshot of all memory; optional clear after snapshot.",
      inputSchema: {
        clear: z.boolean().optional(),
      },
    },
    async ({ clear }) => {
      const snapshot = Object.fromEntries(memoryByUser.entries());
      if (clear === true) {
        memoryByUser.clear();
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              persistedAt: new Date().toISOString(),
              userCount: Object.keys(snapshot).length,
              cleared: clear === true,
              snapshot,
            }),
          },
        ],
      };
    },
  );

  return server;
}

async function closeNodeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (!error) {
        resolveClose();
        return;
      }

      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ERR_SERVER_NOT_RUNNING") {
        resolveClose();
        return;
      }

      rejectClose(error);
    });
  });
}

export async function startMemoryServer(port: number = MEMORY_SERVER_PORT): Promise<StartedMemoryServer> {
  const sessions = new Map<string, SessionEntry>();
  const memoryByUser = new Map<string, MemoryProfile>();

  const httpServer = createHttpServer(async (request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== "/mcp") {
      response.statusCode = 404;
      response.end("Not Found");
      return;
    }

    if (!isAuthorized(request)) {
      response.statusCode = 401;
      response.end("Unauthorized");
      return;
    }

    const method = request.method ?? "GET";
    const sessionId = getHeaderValue(request.headers["mcp-session-id"]);

    try {
      if (method === "POST") {
        const body = await readJsonBody(request);
        const existingSession = sessionId ? sessions.get(sessionId) : undefined;

        if (existingSession) {
          await existingSession.transport.handleRequest(request, response, body);
          return;
        }

        if (sessionId || !isInitializeRequest(body)) {
          response.statusCode = 400;
          response.setHeader("content-type", "application/json");
          response.end(toJsonRpcErrorBody("Bad Request: no valid MCP session."));
          return;
        }

        const sessionServer = createMemoryMcpServer(memoryByUser);
        let transport: StreamableHTTPServerTransport | null = null;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (createdSessionId) => {
            if (!transport) {
              return;
            }
            sessions.set(createdSessionId, {
              server: sessionServer,
              transport,
            });
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId) {
            sessions.delete(closedSessionId);
          }
          void sessionServer.close();
        };

        await sessionServer.connect(transport);
        await transport.handleRequest(request, response, body);
        return;
      }

      if (method === "GET" || method === "DELETE") {
        if (!sessionId) {
          response.statusCode = 400;
          response.end("Missing mcp-session-id header.");
          return;
        }
        const activeSession = sessions.get(sessionId);
        if (!activeSession) {
          response.statusCode = 404;
          response.end("Unknown MCP session.");
          return;
        }

        await activeSession.transport.handleRequest(request, response);
        return;
      }

      response.statusCode = 405;
      response.end("Method Not Allowed");
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(
        toJsonRpcErrorBody(
          `Internal server error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(port, () => {
      httpServer.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    await closeNodeServer(httpServer);
    throw new Error("Failed to resolve memory MCP server port.");
  }

  return {
    port: address.port,
    close: async () => {
      await Promise.allSettled(
        [...sessions.values()].flatMap((entry) => {
          return [entry.transport.close(), entry.server.close()];
        }),
      );
      sessions.clear();
      await closeNodeServer(httpServer);
    },
  };
}
