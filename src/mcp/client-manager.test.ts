import { expect, it, vi } from "vitest";

import type { McpServerConfig } from "../agent/types.js";
import { createMcpClientManager } from "./client-manager.js";

function createServer(name: string): McpServerConfig {
  return {
    name,
    url: `https://example.com/${name}/mcp`,
    auth: "bearer",
  };
}

it("returns null manager when no MCP servers are configured", async () => {
  const manager = await createMcpClientManager([], {});
  expect(manager).toBeNull();
});

it("namespaces discovered tools and routes tool calls to the owning server", async () => {
  const refundServer = createServer("refund");
  const inventoryServer = createServer("inventory");

  const refundCallTool = vi.fn(async () => ({ output: "refund-created" }));
  const inventoryCallTool = vi.fn(async () => ({ output: "inventory-read", isError: true }));

  const connectServer = vi.fn(async (server: McpServerConfig, token: string | undefined) => {
    if (server.name === "refund") {
      expect(token).toBe("token-refund");
      return {
        serverName: "refund",
        tools: [
          {
            name: "create_request",
            description: "Create refund request",
            inputSchema: {
              type: "object" as const,
              description: "refund request payload",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
              },
              required: ["id"],
            },
          },
        ],
        callTool: refundCallTool,
        close: async () => undefined,
      };
    }

    expect(token).toBe("token-inventory");
    return {
      serverName: "inventory",
      tools: [
        {
          name: "get_stock",
          description: "Get stock by SKU",
          inputSchema: {
            type: "object" as const,
            properties: {
              sku: { type: "string" },
            },
            required: ["sku"],
          },
        },
      ],
      callTool: inventoryCallTool,
      close: async () => undefined,
    };
  });

  const manager = await createMcpClientManager(
    [refundServer, inventoryServer],
    {
      refund: "token-refund",
      inventory: "token-inventory",
    },
    { connectServer },
  );

  expect(manager).not.toBeNull();
  expect(manager?.tools.map((tool) => tool.name)).toEqual([
    "mcp__refund__create_request",
    "mcp__inventory__get_stock",
  ]);
  expect(manager?.tools[0]?.inputSchema).toMatchObject({
    type: "object",
    additionalProperties: false,
    description: "refund request payload",
  });

  const refundResult = await manager?.callTool({
    id: "call-1",
    name: "mcp__refund__create_request",
    input: { id: "r1" },
  });
  const inventoryResult = await manager?.callTool({
    id: "call-2",
    name: "mcp__inventory__get_stock",
    input: { sku: "SKU-1" },
  });

  expect(refundCallTool).toHaveBeenCalledWith("create_request", { id: "r1" });
  expect(inventoryCallTool).toHaveBeenCalledWith("get_stock", { sku: "SKU-1" });
  expect(refundResult).toMatchObject({
    toolCallId: "call-1",
    output: "refund-created",
  });
  expect(inventoryResult).toMatchObject({
    toolCallId: "call-2",
    output: "inventory-read",
    isError: true,
  });
  await manager?.dispose();
});

it("logs warnings for unreachable servers and continues with reachable ones", async () => {
  const logger = { warn: vi.fn() };
  const fallbackClose = vi.fn(async () => undefined);
  const connectServer = vi.fn(async (server: McpServerConfig) => {
    if (server.name === "broken") {
      throw new Error("connection refused");
    }

    return {
      serverName: "healthy",
      tools: [
        {
          name: "ping",
          description: "Ping tool",
          inputSchema: { type: "object" as const },
        },
      ],
      callTool: async () => ({ output: "pong" }),
      close: fallbackClose,
    };
  });

  const manager = await createMcpClientManager(
    [createServer("broken"), createServer("healthy")],
    {},
    { connectServer, logger },
  );

  expect(manager).not.toBeNull();
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(manager?.tools.map((tool) => tool.name)).toEqual(["mcp__healthy__ping"]);

  const missingTool = await manager?.callTool({
    id: "missing",
    name: "mcp__broken__ping",
    input: {},
  });
  expect(missingTool).toMatchObject({
    toolCallId: "missing",
    isError: true,
  });

  await manager?.dispose();
  expect(fallbackClose).toHaveBeenCalledTimes(1);
});

it("aggregates dispose failures across MCP connections", async () => {
  const closeA = vi.fn(async () => {
    throw new Error("close-a");
  });
  const closeB = vi.fn(async () => {
    throw new Error("close-b");
  });
  const connectServer = vi.fn(async (server: McpServerConfig) => {
    if (server.name === "a") {
      return {
        serverName: "a",
        tools: [],
        callTool: async () => ({ output: "unused" }),
        close: closeA,
      };
    }

    return {
      serverName: "b",
      tools: [],
      callTool: async () => ({ output: "unused" }),
      close: closeB,
    };
  });

  const manager = await createMcpClientManager(
    [createServer("a"), createServer("b")],
    {},
    { connectServer },
  );

  await expect(async () => {
    try {
      await manager?.dispose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("close-a");
      expect(message).toContain("close-b");
      throw error;
    }
  }).rejects.toThrow(/Failed to close MCP connections/);
});
