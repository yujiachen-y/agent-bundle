import { beforeEach, expect, it, vi } from "vitest";

import {
  agentInstances,
  getModelsMock,
  getProvidersMock,
  importPiMonoLoop,
  resetPiMocks,
} from "./pi-mono-loop.test-helpers.js";

const { PiMonoAgentLoop } = await importPiMonoLoop();

beforeEach(() => {
  resetPiMocks();
});

type Tool = {
  name: string;
  execute: (toolCallId: string, input: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
};

async function runAllToolExecutions(tools: Tool[]): Promise<void> {
  await tools[0].execute("call-read", { path: "/workspace/a.txt", offset: 3, limit: 5 });
  await tools[1].execute("call-write", { path: "/workspace/a.txt", content: "next" });
  await tools[2].execute("call-edit", { path: "/workspace/a.txt", oldText: "a", newText: "b" });
  await tools[3].execute("call-bash", { command: "pwd", timeout: 12 });
}

function expectToolHandlerCalls(toolHandler: ReturnType<typeof vi.fn>): void {
  expect(toolHandler).toHaveBeenNthCalledWith(1, {
    id: "call-read",
    name: "Read",
    input: {
      path: "/workspace/a.txt",
      offset: 3,
      limit: 5,
    },
  });
  expect(toolHandler).toHaveBeenNthCalledWith(2, {
    id: "call-write",
    name: "Write",
    input: {
      path: "/workspace/a.txt",
      content: "next",
    },
  });
  expect(toolHandler).toHaveBeenNthCalledWith(3, {
    id: "call-edit:read",
    name: "Read",
    input: {
      path: "/workspace/a.txt",
    },
  });
  expect(toolHandler).toHaveBeenNthCalledWith(4, {
    id: "call-edit:write",
    name: "Write",
    input: {
      path: "/workspace/a.txt",
      content: "b",
    },
  });
  expect(toolHandler).toHaveBeenNthCalledWith(5, {
    id: "call-bash",
    name: "Bash",
    input: {
      command: "pwd",
      timeout: 12,
    },
  });
}

it("maps gemini provider and installs sandbox-backed tools", async () => {
  const toolHandler = vi.fn(async (call) => ({
    toolCallId: call.id,
    output: call.id.endsWith(":read") ? "a" : `ok:${call.name}`,
  }));

  const loop = new PiMonoAgentLoop();
  await loop.init({
    systemPrompt: "system prompt",
    model: {
      provider: "gemini",
      model: "gemini-2.0-flash",
    },
    toolHandler,
  });

  expect(getModelsMock).toHaveBeenCalledWith("google");
  expect(agentInstances).toHaveLength(1);

  const agent = agentInstances[0];
  expect(agent.setSystemPrompt).toHaveBeenCalledWith("system prompt");

  const tools = agent.setTools.mock.calls[0][0] as Tool[];
  expect(tools.map((tool) => tool.name)).toEqual(["read", "write", "edit", "bash"]);

  await runAllToolExecutions(tools);
  expectToolHandlerCalls(toolHandler);
});

it("throws a clear error for unsupported ollama provider", async () => {
  const loop = new PiMonoAgentLoop();
  await expect(
    loop.init({
      systemPrompt: "system",
      model: {
        provider: "ollama",
        model: "qwen2.5-coder",
      },
      toolHandler: async (call) => ({
        toolCallId: call.id,
        output: "unused",
      }),
    }),
  ).rejects.toThrowError(/ollama/);
});

it("throws when provider is not available in pi-ai", async () => {
  getProvidersMock.mockReturnValueOnce(["openai"]);

  const loop = new PiMonoAgentLoop();
  await expect(
    loop.init({
      systemPrompt: "system",
      model: {
        provider: "openrouter",
        model: "openai/gpt-5-mini",
      },
      toolHandler: async (call) => ({
        toolCallId: call.id,
        output: "unused",
      }),
    }),
  ).rejects.toThrowError(/Unsupported model provider/);
});

it("throws when model id is not available for provider", async () => {
  const loop = new PiMonoAgentLoop();
  await expect(
    loop.init({
      systemPrompt: "system",
      model: {
        provider: "openai",
        model: "missing-model",
      },
      toolHandler: async (call) => ({
        toolCallId: call.id,
        output: "unused",
      }),
    }),
  ).rejects.toThrowError(/Model missing-model is not available/);
});

it("validates tool input fields and surfaces tool errors", async () => {
  const toolHandler = vi.fn(async (call) => ({
    toolCallId: call.id,
    output: {
      stdout: "",
      stderr: "boom",
      exitCode: 9,
    },
    isError: true,
  }));

  const loop = new PiMonoAgentLoop();
  await loop.init({
    systemPrompt: "system",
    model: {
      provider: "openai",
      model: "gpt-5-mini",
    },
    toolHandler,
  });

  const agent = agentInstances[0];
  const tools = agent.setTools.mock.calls[0][0] as Array<{
    execute: (toolCallId: string, input: unknown) => Promise<{
      content: Array<{ type: "text"; text: string }>;
    }>;
  }>;

  await expect(tools[0].execute("call-read", {})).rejects.toThrowError(/field "path" must be a string/);
  await expect(tools[2].execute("call-edit", { path: "/workspace/a.txt" })).rejects.toThrowError(
    /field "oldText" must be a string/,
  );
  await expect(tools[3].execute("call-bash", { command: "exit 9" })).rejects.toThrowError(/exitCode: 9/);
});

it("uses read+write for edit and validates unique match", async () => {
  const toolHandler = vi.fn(async (call) => {
    if (call.id.endsWith(":read")) {
      return {
        toolCallId: call.id,
        output: "aa",
      };
    }

    return {
      toolCallId: call.id,
      output: "ok",
    };
  });

  const loop = new PiMonoAgentLoop();
  await loop.init({
    systemPrompt: "system",
    model: {
      provider: "openai",
      model: "gpt-5-mini",
    },
    toolHandler,
  });

  const agent = agentInstances[0];
  const tools = agent.setTools.mock.calls[0][0] as Tool[];

  await expect(
    tools[2].execute("call-edit", { path: "/workspace/a.txt", oldText: "a", newText: "b" }),
  ).rejects.toThrowError(/Found 2 occurrences/);
  expect(toolHandler).toHaveBeenCalledTimes(1);
  expect(toolHandler).toHaveBeenCalledWith({
    id: "call-edit:read",
    name: "Read",
    input: {
      path: "/workspace/a.txt",
    },
  });
});
