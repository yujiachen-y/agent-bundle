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
export const PRODUCT_SERVER_PORT = 3102;

type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  tags: string[];
};

type SessionEntry = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

type StartedProductServer = {
  port: number;
  close: () => Promise<void>;
};

const CATALOG: readonly Product[] = [
  { id: "p-100", name: "UltraLight Running Shoes", category: "fitness", price: 119, tags: ["running", "sports", "lightweight"] },
  { id: "p-101", name: "Hydration Smart Bottle", category: "fitness", price: 49, tags: ["hydration", "health", "daily"] },
  { id: "p-102", name: "Trail Backpack 20L", category: "outdoors", price: 89, tags: ["hiking", "travel", "outdoors"] },
  { id: "p-103", name: "Noise-Canceling Headphones", category: "audio", price: 249, tags: ["music", "focus", "wireless"] },
  { id: "p-104", name: "Mechanical Keyboard", category: "productivity", price: 139, tags: ["coding", "typing", "desk"] },
  { id: "p-105", name: "Ergonomic Office Chair", category: "productivity", price: 329, tags: ["desk", "comfort", "work"] },
  { id: "p-106", name: "Pour-Over Coffee Kit", category: "kitchen", price: 69, tags: ["coffee", "home", "morning"] },
  { id: "p-107", name: "Smart Sleep Lamp", category: "home", price: 99, tags: ["sleep", "wellness", "home"] },
  { id: "p-108", name: "Compact Drone 4K", category: "electronics", price: 459, tags: ["camera", "travel", "outdoors"] },
  { id: "p-109", name: "Beginner Yoga Mat", category: "fitness", price: 39, tags: ["yoga", "wellness", "home"] },
];

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

function createProductMcpServer(): McpServer {
  const server = new McpServer({
    name: "demo-product-server",
    version: "1.0.0",
  });

  server.registerTool(
    "product_search",
    {
      description: "Search products by query and optional category.",
      inputSchema: {
        query: z.string().optional(),
        category: z.string().optional(),
        maxResults: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ query, category, maxResults }) => {
      const normalizedQuery = (query ?? "").toLowerCase().trim();
      const normalizedCategory = (category ?? "").toLowerCase().trim();

      const matches = CATALOG.filter((product) => {
        if (normalizedCategory.length > 0 && product.category.toLowerCase() !== normalizedCategory) {
          return false;
        }

        if (normalizedQuery.length === 0) {
          return true;
        }

        const haystack = `${product.name} ${product.category} ${product.tags.join(" ")}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      }).slice(0, maxResults ?? 5);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              count: matches.length,
              products: matches,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "product_detail",
    {
      description: "Get full details for a product id.",
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async ({ id }) => {
      const product = CATALOG.find((entry) => entry.id === id) ?? null;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              found: product !== null,
              product,
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

export async function startProductServer(port: number = PRODUCT_SERVER_PORT): Promise<StartedProductServer> {
  const sessions = new Map<string, SessionEntry>();

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

        const sessionServer = createProductMcpServer();
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
    throw new Error("Failed to resolve product MCP server port.");
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
