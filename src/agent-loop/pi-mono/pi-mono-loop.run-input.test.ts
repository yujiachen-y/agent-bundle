import { beforeEach, describe, expect, it } from "vitest";

import {
  agentInstances,
  importPiMonoLoop,
  resetPiMocks,
} from "./pi-mono-loop.test-helpers.js";

const { PiMonoAgentLoop } = await importPiMonoLoop();

beforeEach(() => {
  resetPiMocks();
});

async function createLoop(): Promise<InstanceType<typeof PiMonoAgentLoop>> {
  const loop = new PiMonoAgentLoop();
  await loop.init({
    systemPrompt: "system",
    model: {
      provider: "openai",
      model: "gpt-5-mini",
    },
    toolHandler: async (call) => ({
      toolCallId: call.id,
      output: "tool-result",
    }),
  });

  return loop;
}

async function drainEvents(
  loop: InstanceType<typeof PiMonoAgentLoop>,
  input: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    tool_calls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    tool_results?: Array<{ toolCallId: string; output: unknown; isError?: boolean }>;
  }>,
): Promise<void> {
  for await (const event of loop.run(input)) {
    void event;
  }
}

function mockSuccessfulAssistantMessage(): {
  role: string;
  content: Array<{ type: "text"; text: string }>;
  api: string;
  provider: string;
  model: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
  stopReason: string;
  timestamp: number;
} {
  return {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5-mini",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("PiMonoAgentLoop input conversion", () => {
  it("converts assistant tool_calls and tool_results into pi message roles", async () => {
    const loop = await createLoop();
    const agent = agentInstances[0];

    agent.continue.mockImplementationOnce(async () => {
      agent.state.messages = [mockSuccessfulAssistantMessage()];
    });

    await drainEvents(loop, [
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "tool-1", name: "Read", input: { path: "/skills/a/SKILL.md" } }],
      },
      {
        role: "tool",
        content: "",
        tool_results: [{ toolCallId: "tool-1", output: { text: "tool output" } }],
      },
      { role: "user", content: "second" },
    ]);

    const replaceCall = agent.replaceMessages.mock.calls[0][0] as Array<{ role: string }>;
    expect(replaceCall.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "user",
    ]);
  });

  it("handles tool role entries without tool_results", async () => {
    const loop = await createLoop();
    const agent = agentInstances[0];

    agent.continue.mockImplementationOnce(async () => {
      agent.state.messages = [mockSuccessfulAssistantMessage()];
    });

    await drainEvents(loop, [
      { role: "user", content: "q1" },
      { role: "tool", content: "fallback-tool-content", tool_results: [] },
      { role: "user", content: "q2" },
    ]);

    const replaceCall = agent.replaceMessages.mock.calls[0][0] as Array<{
      role: string;
      content?: Array<{ type: string; text?: string }>;
    }>;

    expect(replaceCall.map((message) => message.role)).toEqual([
      "user",
      "toolResult",
      "user",
    ]);
    expect(replaceCall[1].content?.[0].text).toBe("fallback-tool-content");
  });

  it("disposes idempotently", async () => {
    const loop = await createLoop();
    const agent = agentInstances[0];

    await loop.dispose();
    await loop.dispose();

    expect(agent.abort).toHaveBeenCalledTimes(1);
    expect(agent.waitForIdle).toHaveBeenCalledTimes(1);
  });
});
