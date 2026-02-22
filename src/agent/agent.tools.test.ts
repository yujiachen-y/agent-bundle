import { expect, it } from "vitest";

import type { ToolCall } from "../agent-loop/index.js";
import type { McpClientManager } from "./dependencies.js";
import { createHarness } from "./agent.test-helpers.js";

it("routes Read Write Bash and MCP calls through toolHandler", async () => {
  const mcpCalls: ToolCall[] = [];
  const mcpClientManager: McpClientManager = {
    callTool: async (call) => {
      mcpCalls.push(call);
      return {
        toolCallId: call.id,
        output: "mcp-result",
      };
    },
    dispose: async () => undefined,
  };

  const harness = createHarness({
    configOverrides: {
      mcp: [{ name: "refund", url: "https://example.com/mcp", auth: "bearer" }],
    },
    initOverrides: {
      mcpTokens: {
        refund: "token-1",
      },
    },
    mcpClientManager,
  });

  await harness.agent.initialize();
  const toolHandler = harness.loop.initConfigs[0].toolHandler;

  const readResult = await toolHandler({
    id: "tool-read",
    name: "Read",
    input: { path: "/workspace/input.txt" },
  });
  const writeResult = await toolHandler({
    id: "tool-write",
    name: "Write",
    input: { path: "/workspace/output.txt", content: "new-content" },
  });

  harness.sandbox.nextExecResult = {
    stdout: "",
    stderr: "failed",
    exitCode: 1,
  };
  const onChunk = (chunk: string) => {
    void chunk;
    return undefined;
  };
  const bashResult = await toolHandler({
    id: "tool-bash",
    name: "Bash",
    input: { command: "exit 1", timeout: 30, cwd: "/workspace", onChunk },
  });

  const mcpResult = await toolHandler({
    id: "tool-mcp",
    name: "mcp__refund__create_request",
    input: { id: "r1" },
  });

  expect(readResult).toMatchObject({ toolCallId: "tool-read", output: "sandbox-file-content" });
  expect(writeResult.toolCallId).toBe("tool-write");
  expect(bashResult).toMatchObject({ toolCallId: "tool-bash", isError: true });
  expect(String(bashResult.output)).toContain("exitCode: 1");
  expect(String(bashResult.output)).toContain("stderr:\nfailed");
  expect(mcpResult).toMatchObject({ toolCallId: "tool-mcp", output: "mcp-result" });
  expect(harness.sandbox.readCalls).toEqual(["/workspace/input.txt"]);
  expect(harness.sandbox.writeCalls[0]).toEqual({ path: "/workspace/output.txt", content: "new-content" });
  expect(harness.sandbox.execCalls[0]).toEqual({
    command: "exit 1",
    options: {
      timeout: 30,
      cwd: "/workspace",
      onChunk,
    },
  });
  expect(mcpCalls[0].name).toBe("mcp__refund__create_request");
});

it("returns errors for invalid fields unsupported tools and unavailable MCP", async () => {
  const harness = createHarness();
  await harness.agent.initialize();

  const toolHandler = harness.loop.initConfigs[0].toolHandler;
  const invalidRead = await toolHandler({ id: "t1", name: "Read", input: {} });
  const unsupported = await toolHandler({ id: "t2", name: "Edit", input: {} });
  const missingMcp = await toolHandler({ id: "t3", name: "mcp__a__b", input: {} });

  expect(invalidRead).toMatchObject({ toolCallId: "t1", isError: true });
  expect(unsupported).toMatchObject({ toolCallId: "t2", isError: true });
  expect(missingMcp).toMatchObject({ toolCallId: "t3", isError: true });
});

it("allows Write tool to create empty files", async () => {
  const harness = createHarness();
  await harness.agent.initialize();

  const toolHandler = harness.loop.initConfigs[0].toolHandler;
  const writeResult = await toolHandler({
    id: "write-empty",
    name: "Write",
    input: {
      path: "/workspace/empty.txt",
      content: "",
    },
  });

  expect(writeResult.toolCallId).toBe("write-empty");
  expect(harness.sandbox.writeCalls[0]).toEqual({
    path: "/workspace/empty.txt",
    content: "",
  });
});
