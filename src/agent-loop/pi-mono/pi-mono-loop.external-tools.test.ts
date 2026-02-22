import { beforeEach, expect, it, vi } from "vitest";

import {
  agentInstances,
  importPiMonoLoop,
  resetPiMocks,
} from "./pi-mono-loop.test-helpers.js";

const { PiMonoAgentLoop } = await importPiMonoLoop();

beforeEach(() => {
  resetPiMocks();
});

type Tool = {
  name: string;
  execute: (
    toolCallId: string,
    input: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

it("registers external tools and forwards their input to toolHandler", async () => {
  const toolHandler = vi.fn(async (call) => ({
    toolCallId: call.id,
    output: "mcp-ok",
  }));

  const loop = new PiMonoAgentLoop();
  await loop.init({
    systemPrompt: "system",
    model: {
      provider: "openai",
      model: "gpt-5-mini",
    },
    toolHandler,
    externalTools: [
      {
        name: "mcp__refund__create_request",
        description: "Create refund request",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
      },
    ],
  });

  const agent = agentInstances[0];
  const tools = agent.setTools.mock.calls[0][0] as Tool[];
  expect(tools.map((tool) => tool.name)).toEqual([
    "read",
    "write",
    "edit",
    "bash",
    "mcp__refund__create_request",
  ]);

  const result = await tools[4].execute("call-mcp", { id: "r1" });
  expect(result.content[0].text).toBe("mcp-ok");
  expect(toolHandler).toHaveBeenCalledWith({
    id: "call-mcp",
    name: "mcp__refund__create_request",
    input: { id: "r1" },
  });
});
