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

it("supports ollama via openai-compatible custom model", async () => {
  const previousOllamaBaseUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";

  try {
    const loop = new PiMonoAgentLoop();
    await loop.init({
      systemPrompt: "system",
      model: {
        provider: "ollama",
        model: "gpt-oss:20b",
      },
      toolHandler: async (call) => ({
        toolCallId: call.id,
        output: "unused",
      }),
    });

    expect(getProvidersMock).not.toHaveBeenCalled();
    expect(getModelsMock).not.toHaveBeenCalled();
    expect(agentInstances).toHaveLength(1);

    const agent = agentInstances[0];
    const initialState = (
      agent.options as {
        initialState: {
          model: {
            id: string;
            provider: string;
            api: string;
            baseUrl: string;
            contextWindow: number;
            maxTokens: number;
          };
        };
      }
    ).initialState;
    const getApiKey = (agent.options as { getApiKey: (provider: string) => string | undefined }).getApiKey;

    expect(initialState.model.id).toBe("gpt-oss:20b");
    expect(initialState.model.provider).toBe("ollama");
    expect(initialState.model.api).toBe("openai-completions");
    expect(initialState.model.baseUrl).toBe("http://localhost:11434/v1");
    expect(initialState.model.contextWindow).toBe(128_000);
    expect(initialState.model.maxTokens).toBe(32_000);
    expect(getApiKey("ollama")).toBe("ollama");
    expect(getApiKey("openai")).toBeUndefined();
  } finally {
    if (previousOllamaBaseUrl === undefined) {
      delete process.env.OLLAMA_BASE_URL;
    } else {
      process.env.OLLAMA_BASE_URL = previousOllamaBaseUrl;
    }
  }
});

it("keeps configured ollama /v1 base URL and api key", async () => {
  const previousOllamaBaseUrl = process.env.OLLAMA_BASE_URL;
  const previousOllamaApiKey = process.env.OLLAMA_API_KEY;
  process.env.OLLAMA_BASE_URL = "http://localhost:11434/v1";
  process.env.OLLAMA_API_KEY = "custom-ollama-key";

  try {
    const loop = new PiMonoAgentLoop();
    await loop.init({
      systemPrompt: "system",
      model: {
        provider: "ollama",
        model: "qwen2.5-coder",
        ollama: {
          baseUrl: "http://localhost:11434",
          contextWindow: 16_384,
          maxTokens: 4_096,
        },
      },
      toolHandler: async (call) => ({
        toolCallId: call.id,
        output: "unused",
      }),
    });

    expect(agentInstances).toHaveLength(1);
    const agent = agentInstances[0];
    const initialState = (
      agent.options as {
        initialState: {
          model: {
            baseUrl: string;
            contextWindow: number;
            maxTokens: number;
          };
        };
      }
    ).initialState;
    const getApiKey = (agent.options as { getApiKey: (provider: string) => string | undefined }).getApiKey;

    expect(initialState.model.baseUrl).toBe("http://localhost:11434/v1");
    expect(initialState.model.contextWindow).toBe(16_384);
    expect(initialState.model.maxTokens).toBe(4_096);
    expect(getApiKey("ollama")).toBe("custom-ollama-key");
  } finally {
    if (previousOllamaBaseUrl === undefined) {
      delete process.env.OLLAMA_BASE_URL;
    } else {
      process.env.OLLAMA_BASE_URL = previousOllamaBaseUrl;
    }

    if (previousOllamaApiKey === undefined) {
      delete process.env.OLLAMA_API_KEY;
    } else {
      process.env.OLLAMA_API_KEY = previousOllamaApiKey;
    }
  }
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
