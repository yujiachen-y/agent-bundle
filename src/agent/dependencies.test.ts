import { expect, it } from "vitest";

import { PiMonoAgentLoop } from "../agent-loop/index.js";
import { createDefaultDependencies } from "./dependencies.js";

it("creates PiMono loop and returns null MCP manager when no servers configured", async () => {
  const dependencies = createDefaultDependencies();

  const loop = dependencies.createLoop();
  const mcpManager = await dependencies.createMcpClientManager([], {});

  expect(loop).toBeInstanceOf(PiMonoAgentLoop);
  expect(mcpManager).toBeNull();
});

it("returns an MCP placeholder manager when servers exist", async () => {
  const dependencies = createDefaultDependencies();
  const mcpManager = await dependencies.createMcpClientManager(
    [{ name: "refund", url: "https://example.com/mcp", auth: "bearer" }],
    { refund: "token-1" },
  );

  expect(mcpManager).not.toBeNull();

  const result = await mcpManager?.callTool({
    id: "tool-1",
    name: "mcp__refund__create_request",
    input: {},
  });

  expect(result).toMatchObject({
    toolCallId: "tool-1",
    isError: true,
  });
  await mcpManager?.dispose();
});
