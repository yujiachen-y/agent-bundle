import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type MemoryProfile = Record<string, unknown>;

const memoryByUser = new Map<string, MemoryProfile>();

function createMemoryMcpServer(): McpServer {
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
            type: "text" as const,
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
            type: "text" as const,
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
            type: "text" as const,
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
            type: "text" as const,
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

const server = createMemoryMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGTERM", () => {
  void server
    .close()
    .catch(() => {})
    .then(() => process.exit(0));
});

process.on("SIGINT", () => {
  void server
    .close()
    .catch(() => {})
    .then(() => process.exit(0));
});
