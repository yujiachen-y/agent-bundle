import { beforeEach, expect, it, vi } from "vitest";

import { PiMonoAgentLoop } from "../agent-loop/index.js";

const createMcpClientManagerMock = vi.fn();

vi.mock("../mcp/index.js", () => ({
  createMcpClientManager: createMcpClientManagerMock,
}));

const { createDefaultDependencies } = await import("./dependencies.js");

beforeEach(() => {
  createMcpClientManagerMock.mockReset();
  createMcpClientManagerMock.mockResolvedValue(null);
});

it("creates PiMono loop and delegates empty MCP config", async () => {
  const dependencies = createDefaultDependencies();

  const loop = dependencies.createLoop();
  const mcpManager = await dependencies.createMcpClientManager([], {});

  expect(loop).toBeInstanceOf(PiMonoAgentLoop);
  expect(createMcpClientManagerMock).toHaveBeenCalledWith([], {}, { sandbox: null });
  expect(mcpManager).toBeNull();
});

it("delegates MCP manager creation when servers exist", async () => {
  const fakeManager = {
    tools: [],
    callTool: vi.fn(),
    dispose: vi.fn(),
  };
  createMcpClientManagerMock.mockResolvedValue(fakeManager);

  const dependencies = createDefaultDependencies();
  const servers = [
    {
      transport: "http" as const,
      name: "refund",
      url: "https://example.com/mcp",
      auth: "bearer" as const,
    },
  ];
  const tokens = { refund: "token-1" };
  const mcpManager = await dependencies.createMcpClientManager(
    servers,
    tokens,
  );

  expect(createMcpClientManagerMock).toHaveBeenCalledWith(servers, tokens, { sandbox: null });
  expect(mcpManager).toBe(fakeManager);
});
