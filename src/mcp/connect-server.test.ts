import { beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerConfig } from "../agent/types.js";
import type { SandboxIO } from "../sandbox/types.js";

const mockState = vi.hoisted(() => ({
  clients: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }>,
  sseTransports: [] as Array<{
    url: URL;
    options: unknown;
    close: ReturnType<typeof vi.fn>;
  }>,
  httpTransports: [] as Array<{
    url: URL;
    options: unknown;
    close: ReturnType<typeof vi.fn>;
  }>,
  stdioTransports: [] as Array<{
    options: unknown;
    close: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@modelcontextprotocol/sdk/client", () => {
  class MockClient {
    public readonly connect = vi.fn(async () => undefined);
    public readonly listTools = vi.fn(async () => ({
      tools: [],
      nextCursor: undefined,
    }));
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

describe("toServerLocation", () => {
  it("returns URL for HTTP servers", () => {
    const server: McpServerConfig = {
      transport: "http",
      name: "http-server",
      url: "https://api.example.com/mcp",
      auth: "bearer",
    };

    expect(toServerLocation(server)).toBe("https://api.example.com/mcp");
  });

  it("returns URL for SSE servers", () => {
    const server: McpServerConfig = {
      transport: "sse",
      name: "sse-server",
      url: "https://events.example.com/mcp",
      auth: "bearer",
    };

    expect(toServerLocation(server)).toBe("https://events.example.com/mcp");
  });

  it("returns command with args for stdio servers", () => {
    const server: McpServerConfig = {
      transport: "stdio",
      name: "stdio-server",
      command: "node",
      args: ["server.js", "--verbose"],
    };

    expect(toServerLocation(server)).toBe("node server.js --verbose");
  });

  it("returns command only for stdio servers without args", () => {
    const server: McpServerConfig = {
      transport: "stdio",
      name: "stdio-server",
      command: "node",
    };

    expect(toServerLocation(server)).toBe("node");
  });
});

describe("defaultConnectServer", () => {
  beforeEach(() => {
    mockState.clients.length = 0;
    mockState.sseTransports.length = 0;
    mockState.httpTransports.length = 0;
    mockState.stdioTransports.length = 0;
  });

  it("throws for stdio servers when sandbox is missing", async () => {
    const server: McpServerConfig = {
      transport: "stdio",
      name: "local",
      command: "node",
      args: ["server.js"],
    };

    await expect(defaultConnectServer(server, undefined, null)).rejects.toThrow(
      'stdio MCP server "local" requires a sandbox',
    );
    expect(mockState.clients).toHaveLength(0);
    expect(mockState.stdioTransports).toHaveLength(0);
  });

  it("uses SandboxStdioTransport when sandbox is provided", async () => {
    const sandbox = createSandbox();
    const server: McpServerConfig = {
      transport: "stdio",
      name: "local",
      command: "node",
      args: ["server.js"],
      env: { NODE_ENV: "test" },
    };

    const connection = await defaultConnectServer(server, undefined, sandbox);

    expect(mockState.stdioTransports).toHaveLength(1);
    expect(mockState.stdioTransports[0]?.options).toEqual({
      sandbox,
      command: "node",
      args: ["server.js"],
      env: { NODE_ENV: "test" },
    });
    expect(mockState.clients).toHaveLength(1);
    expect(mockState.clients[0]?.connect).toHaveBeenCalledTimes(1);
    expect(connection.serverName).toBe("local");
    expect(connection.tools).toEqual([]);

    await connection.close();
    expect(mockState.clients[0]?.close).toHaveBeenCalledTimes(1);
    expect(mockState.stdioTransports[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("passes bearer token headers to SSE transport when auth is bearer", async () => {
    const server: McpServerConfig = {
      transport: "sse",
      name: "events",
      url: "https://events.example.com/mcp",
      auth: "bearer",
    };

    await defaultConnectServer(server, "secret-token", null);

    expect(mockState.sseTransports).toHaveLength(1);
    expect(mockState.sseTransports[0]?.url.toString()).toBe("https://events.example.com/mcp");
    expect(mockState.sseTransports[0]?.options).toEqual({
      requestInit: {
        headers: {
          Authorization: "Bearer secret-token",
        },
      },
    });
  });

  it("omits auth headers for SSE transport when auth is not configured", async () => {
    const server: McpServerConfig = {
      transport: "sse",
      name: "events",
      url: "https://events.example.com/mcp",
    };

    await defaultConnectServer(server, "secret-token", null);

    expect(mockState.sseTransports).toHaveLength(1);
    expect(mockState.sseTransports[0]?.options).toBeUndefined();
  });
});
