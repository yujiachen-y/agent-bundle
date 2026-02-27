import { describe, expect, it, vi } from "vitest";

import type { ToolCall, ToolResult } from "../agent-loop/types.js";

import {
  createAgentHooks,
  createMcpCallInstrumenter,
  createToolCallInstrumenter,
} from "./hooks.js";
import { createObservabilityProvider } from "./provider.js";

const provider = createObservabilityProvider();

describe("createAgentHooks", () => {
  it("onRespondStart returns a monotonic timestamp", () => {
    const hooks = createAgentHooks(provider, "test-agent");
    const before = performance.now();
    const startMs = hooks.onRespondStart();
    const after = performance.now();

    expect(startMs).toBeGreaterThanOrEqual(before);
    expect(startMs).toBeLessThanOrEqual(after);
  });

  it("onRespondEnd does not throw on success", () => {
    const hooks = createAgentHooks(provider, "test-agent");
    const startMs = hooks.onRespondStart();

    expect(() => hooks.onRespondEnd(startMs)).not.toThrow();
  });

  it("onRespondEnd records error attribute when error is provided", () => {
    const hooks = createAgentHooks(provider, "test-agent");
    const startMs = hooks.onRespondStart();

    expect(() => hooks.onRespondEnd(startMs, new Error("fail"))).not.toThrow();
  });

  it("onTokenUsage records without throwing", () => {
    const hooks = createAgentHooks(provider, "test-agent");

    expect(() =>
      hooks.onTokenUsage({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      }),
    ).not.toThrow();
  });

  it("works without agent name", () => {
    const hooks = createAgentHooks(provider);
    const startMs = hooks.onRespondStart();

    expect(() => hooks.onRespondEnd(startMs)).not.toThrow();
  });
});

describe("createToolCallInstrumenter", () => {
  it("returns the result of the execute function", async () => {
    const instrumentToolCall = createToolCallInstrumenter(provider);
    const call: ToolCall = { id: "tc-1", name: "bash", input: { command: "ls" } };
    const expected: ToolResult = { toolCallId: "tc-1", output: "files" };

    const result = await instrumentToolCall(call, async () => expected);

    expect(result).toEqual(expected);
  });

  it("propagates errors from the execute function", async () => {
    const instrumentToolCall = createToolCallInstrumenter(provider);
    const call: ToolCall = { id: "tc-2", name: "bash", input: { command: "fail" } };

    await expect(
      instrumentToolCall(call, async () => {
        throw new Error("exec failed");
      }),
    ).rejects.toThrow("exec failed");
  });

  it("handles tool results with isError flag", async () => {
    const instrumentToolCall = createToolCallInstrumenter(provider);
    const call: ToolCall = { id: "tc-3", name: "read", input: { path: "/nope" } };
    const errorResult: ToolResult = {
      toolCallId: "tc-3",
      output: "not found",
      isError: true,
    };

    const result = await instrumentToolCall(call, async () => errorResult);

    expect(result).toEqual(errorResult);
  });

  it("calls execute with the original call object", async () => {
    const instrumentToolCall = createToolCallInstrumenter(provider);
    const call: ToolCall = { id: "tc-4", name: "write", input: { path: "/a" } };
    const executeFn = vi.fn<(c: ToolCall) => Promise<ToolResult>>();
    executeFn.mockResolvedValue({ toolCallId: "tc-4", output: "ok" });

    await instrumentToolCall(call, executeFn);

    expect(executeFn).toHaveBeenCalledWith(call);
  });
});

describe("createMcpCallInstrumenter", () => {
  it("returns the result of the execute function", async () => {
    const instrumentMcpCall = createMcpCallInstrumenter(provider);
    const expected: ToolResult = { toolCallId: "tc-5", output: "mcp result" };

    const result = await instrumentMcpCall("my-server", "my-tool", async () => expected);

    expect(result).toEqual(expected);
  });

  it("propagates errors from the execute function", async () => {
    const instrumentMcpCall = createMcpCallInstrumenter(provider);

    await expect(
      instrumentMcpCall("my-server", "my-tool", async () => {
        throw new Error("mcp failed");
      }),
    ).rejects.toThrow("mcp failed");
  });

  it("handles MCP results with isError flag", async () => {
    const instrumentMcpCall = createMcpCallInstrumenter(provider);
    const errorResult: ToolResult = {
      toolCallId: "tc-6",
      output: "server error",
      isError: true,
    };

    const result = await instrumentMcpCall("srv", "tool", async () => errorResult);

    expect(result).toEqual(errorResult);
  });
});
