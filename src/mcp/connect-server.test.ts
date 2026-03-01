import { beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerConfig } from "../agent/types.js";
import type { SandboxIO } from "../sandbox/types.js";

const mockState = vi.hoisted(() => ({
  clients: [] as Array<{ connect: ReturnType<typeof vi.fn>; listTools: ReturnType<typeof vi.fn>; callTool: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>,
  sseTransports: [] as Array<{ url: URL; options: unknown; close: ReturnType<typeof vi.fn> }>,
  httpTransports: [] as Array<{ url: URL; options: unknown; close: ReturnType<typeof vi.fn> }>,
  stdioTransports: [] as Array<{ options: unknown; close: ReturnType<typeof vi.fn> }>,
  listToolsQueue: [] as Array<{ tools: Array<{ name: string; description?: unknown; inputSchema?: unknown }>; nextCursor?: string }>,
  callToolQueue: [] as Array<{ toolResult?: unknown; content?: Array<{ type: string; text?: string }>; structuredContent?: unknown; isError?: boolean }>,
}));

vi.mock("@modelcontextprotocol/sdk/client", () => {
  class MockClient {
    public readonly connect = vi.fn(async () => undefined);
    public readonly listTools = vi.fn(async () => {
      const nextPage = mockState.listToolsQueue.shift();
      if (nextPage) {
        return nextPage;
      }

      return {
        tools: [],
        nextCursor: undefined,
      };
    });
    public readonly callTool = vi.fn(async () => {
      const nextResult = mockState.callToolQueue.shift();
      if (nextResult) {
        return nextResult;
      }

      return { content: [] };
    });
    public readonly close = vi.fn(async () => undefined);

    public constructor() {
      mockState.clients.push(this);
    }
  }

  return { Client: MockClient };
});

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => {
  class MockSSEClientTransport {
    public readonly close = vi.fn(async () => undefined);

    public constructor(public readonly url: URL, public readonly options?: unknown) {
      mockState.sseTransports.push({
        url,
        options,
        close: this.close,
      });
    }
  }

  return { SSEClientTransport: MockSSEClientTransport };
});

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  class MockStreamableHTTPClientTransport {
    public readonly close = vi.fn(async () => undefined);

    public constructor(public readonly url: URL, public readonly options?: unknown) {
      mockState.httpTransports.push({
        url,
        options,
        close: this.close,
      });
    }
  }

  return { StreamableHTTPClientTransport: MockStreamableHTTPClientTransport };
});

vi.mock("./sandbox-stdio-transport.js", () => {
  class MockSandboxStdioTransport {
    public readonly close = vi.fn(async () => undefined);

    public constructor(public readonly options: unknown) {
      mockState.stdioTransports.push({
        options,
        close: this.close,
      });
    }
  }

  return { SandboxStdioTransport: MockSandboxStdioTransport };
});

import { defaultConnectServer, toServerLocation } from "./connect-server.js";

function createSandbox(): SandboxIO {
  return {
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    spawn: async () => {
      throw new Error("spawn should not be called in this test");
    },
    file: {
      read: async () => "",
      write: async () => undefined,
      list: async () => [],
      delete: async () => undefined,
    },
  };
}

const HTTP_SERVER: McpServerConfig = {
  transport: "http",
  name: "api",
  url: "https://api.example.com/mcp",
  auth: "bearer",
};

function createSseServer(auth?: "bearer"): McpServerConfig {
  if (auth) {
    return {
      transport: "sse",
      name: "events",
      url: "https://events.example.com/mcp",
      auth,
    };
  }

  return {
    transport: "sse",
    name: "events",
    url: "https://events.example.com/mcp",
  };
}

function createStdioServer(): McpServerConfig {
  return { transport: "stdio", name: "local", command: "node", args: ["server.js"], env: { NODE_ENV: "test" } };
}

function resetMockState(): void {
  mockState.clients.length = 0;
  mockState.sseTransports.length = 0;
  mockState.httpTransports.length = 0;
  mockState.stdioTransports.length = 0;
  mockState.listToolsQueue.length = 0;
  mockState.callToolQueue.length = 0;
}

describe("toServerLocation", () => {
  it("returns expected location strings", () => {
    expect(toServerLocation(HTTP_SERVER)).toBe("https://api.example.com/mcp");
    expect(toServerLocation(createSseServer("bearer"))).toBe("https://events.example.com/mcp");
    expect(toServerLocation(createStdioServer())).toBe("node server.js");
  });
});

describe("defaultConnectServer with stdio transport", () => {
  beforeEach(resetMockState);

  it("throws when sandbox is missing", async () => {
    await expect(defaultConnectServer(createStdioServer(), undefined, null)).rejects.toThrow(
      'stdio MCP server "local" requires a sandbox',
    );
    expect(mockState.clients).toHaveLength(0);
    expect(mockState.stdioTransports).toHaveLength(0);
  });

  it("uses SandboxStdioTransport when sandbox is provided", async () => {
    const sandbox = createSandbox();
    const connection = await defaultConnectServer(createStdioServer(), undefined, sandbox);

    expect(mockState.stdioTransports).toHaveLength(1);
    expect(mockState.stdioTransports[0]?.options).toEqual({
      sandbox,
      command: "node",
      args: ["server.js"],
      env: { NODE_ENV: "test" },
    });
    expect(connection.serverName).toBe("local");
    expect(connection.tools).toEqual([]);

    await connection.close();
    expect(mockState.clients[0]?.close).toHaveBeenCalledTimes(1);
    expect(mockState.stdioTransports[0]?.close).toHaveBeenCalledTimes(1);
  });
});

describe("defaultConnectServer remote transport headers", () => {
  beforeEach(resetMockState);

  it("passes bearer token headers to SSE transport when auth is bearer", async () => {
    await defaultConnectServer(createSseServer("bearer"), "secret-token", null);

    expect(mockState.sseTransports).toHaveLength(1);
    expect(mockState.sseTransports[0]?.options).toEqual({
      requestInit: {
        headers: {
          Authorization: "Bearer secret-token",
        },
      },
    });
  });

  it("omits auth headers for SSE transport when auth is not configured", async () => {
    await defaultConnectServer(createSseServer(), "secret-token", null);

    expect(mockState.sseTransports).toHaveLength(1);
    expect(mockState.sseTransports[0]?.options).toBeUndefined();
  });

  it("passes bearer token headers to streamable HTTP transport", async () => {
    await defaultConnectServer(HTTP_SERVER, "secret-token", null);

    expect(mockState.httpTransports).toHaveLength(1);
    expect(mockState.httpTransports[0]?.options).toEqual({
      requestInit: {
        headers: {
          Authorization: "Bearer secret-token",
        },
      },
    });
  });

  it("omits auth headers for streamable HTTP transport when token is missing", async () => {
    await defaultConnectServer(HTTP_SERVER, undefined, null);

    expect(mockState.httpTransports).toHaveLength(1);
    expect(mockState.httpTransports[0]?.options).toBeUndefined();
  });
});

describe("defaultConnectServer tool discovery and call behavior", () => {
  beforeEach(resetMockState);

  it("collects paginated tools and normalizes schemas and descriptions", async () => {
    mockState.listToolsQueue.push(
      {
        tools: [
          {
            name: "search",
            description: " ",
            inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          },
        ],
        nextCursor: "page-2",
      },
      {
        tools: [
          {
            name: "detail",
            inputSchema: { type: "string" },
          },
          { name: "sanitize", description: 123, inputSchema: { type: "object", properties: "bad", required: [1] } },
        ],
      },
    );

    const connection = await defaultConnectServer(createSseServer(), undefined, null);

    expect(mockState.clients[0]?.listTools).toHaveBeenCalledTimes(2);
    expect(connection.tools).toEqual([
      {
        name: "search",
        description: "MCP tool",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      {
        name: "detail",
        description: "MCP tool",
        inputSchema: { type: "object" },
      },
      { name: "sanitize", description: "MCP tool", inputSchema: { type: "object" } },
    ]);
  });

  it("returns text, structured, toolResult, and error outputs from callTool", async () => {
    mockState.callToolQueue.push(
      {
        content: [
          { type: "text", text: "  line1  " },
          { type: "image" },
          { type: "text", text: "line2" },
        ],
      },
      {
        content: [],
        structuredContent: { ok: true },
      },
      {
        toolResult: { result: "done" },
      },
      {
        content: [{ type: "text", text: "failed" }],
        isError: true,
      },
      { content: [{ type: "image" }] },
    );

    const connection = await defaultConnectServer(createSseServer(), undefined, null);
    await expect(connection.callTool("search", {})).resolves.toEqual({ output: "line1\n\nline2", isError: false });
    await expect(connection.callTool("search", {})).resolves.toEqual({ output: { ok: true }, isError: false });
    await expect(connection.callTool("search", {})).resolves.toEqual({ output: { result: "done" }, isError: false });
    await expect(connection.callTool("search", {})).resolves.toEqual({ output: "failed", isError: true });
    await expect(connection.callTool("search", {})).resolves.toEqual({ output: [{ type: "image" }], isError: false });
    expect(mockState.clients[0]?.callTool).toHaveBeenCalledTimes(5);
  });

  it("surfaces close errors from both client and transport", async () => {
    const connection = await defaultConnectServer(createSseServer(), undefined, null);
    mockState.clients[0]?.close.mockRejectedValueOnce(new Error("client close failed"));
    mockState.sseTransports[0]?.close.mockRejectedValueOnce(new Error("transport close failed"));

    await expect(connection.close()).rejects.toThrow("client close failed | transport close failed");
  });
});
