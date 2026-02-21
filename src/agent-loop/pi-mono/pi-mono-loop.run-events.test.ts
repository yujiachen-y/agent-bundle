import { beforeEach, expect, it } from "vitest";

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

async function collectEvents(
  loop: InstanceType<typeof PiMonoAgentLoop>,
  input: Array<{
    role: "system" | "user";
    content: string;
  }>,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of loop.run(input)) {
    events.push(event as unknown as Record<string, unknown>);
  }

  return events;
}

function buildAssistantMessage(outputText: string, inputTokens: number): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "text", text: outputText }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5-mini",
    usage: {
      input: inputTokens,
      output: 7,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: inputTokens + 7,
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

function emitSuccessfulStream(agent: (typeof agentInstances)[number]): void {
  agent.emit({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "read",
    args: { path: "/skills/test/SKILL.md" },
  });
  agent.emit({
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "read",
    args: { path: "/skills/test/SKILL.md" },
    partialResult: { content: [{ type: "text", text: "partial-chunk" }] },
  });
  agent.emit({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "read",
    result: { content: [{ type: "text", text: "done" }] },
    isError: false,
  });
  agent.emit({
    type: "message_update",
    message: { role: "assistant", content: [] },
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "hello ",
      partial: { role: "assistant" },
    },
  });
  agent.emit({
    type: "message_update",
    message: { role: "assistant", content: [] },
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "world",
      partial: { role: "assistant" },
    },
  });
}

it("maps streaming/tool events and completes with usage", async () => {
  const loop = await createLoop();
  const agent = agentInstances[0];

  agent.continue.mockImplementationOnce(async () => {
    emitSuccessfulStream(agent);
    agent.state.messages = [buildAssistantMessage("hello world", 12)];
  });

  const events = await collectEvents(loop, [{ role: "user", content: "ping" }]);

  expect(events.map((event) => event.type)).toEqual([
    "response.created",
    "response.tool_call.created",
    "tool_execution_update",
    "response.tool_call.done",
    "response.output_text.delta",
    "response.output_text.delta",
    "response.output_text.done",
    "response.completed",
  ]);
  expect(events[7]).toMatchObject({
    type: "response.completed",
    output: {
      output: "hello world",
      usage: {
        inputTokens: 12,
        outputTokens: 7,
        totalTokens: 19,
      },
    },
  });
});

it("emits response.error when pi-mono reports runtime error", async () => {
  const loop = await createLoop();
  const agent = agentInstances[0];

  agent.continue.mockImplementationOnce(async () => {
    agent.state.error = "llm failed";
  });

  const events = await collectEvents(loop, [{ role: "user", content: "ping" }]);
  expect(events.map((event) => event.type)).toEqual([
    "response.created",
    "response.error",
  ]);
  expect(events[1]).toMatchObject({ type: "response.error", error: "llm failed" });
});

it("throws when run is called before init", async () => {
  const loop = new PiMonoAgentLoop();

  await expect(async () => {
    for await (const event of loop.run([{ role: "user", content: "ping" }])) {
      void event;
    }
  }).rejects.toThrowError(/not initialized/);
});

it("emits response.error when input contains only system messages", async () => {
  const loop = await createLoop();
  const events = await collectEvents(loop, [{ role: "system", content: "ignored" }]);

  expect(events.map((event) => event.type)).toEqual([
    "response.created",
    "response.error",
  ]);
});

it("emits response.error from unknown thrown values", async () => {
  const loop = await createLoop();
  const agent = agentInstances[0];

  agent.continue.mockImplementationOnce(async () => {
    throw "panic-value";
  });

  const events = await collectEvents(loop, [{ role: "user", content: "ping" }]);
  expect(events.map((event) => event.type)).toEqual([
    "response.created",
    "response.error",
  ]);
  expect(events[1]).toMatchObject({ type: "response.error", error: "panic-value" });
});

it("skips empty tool update chunks and omits invalid usage", async () => {
  const loop = await createLoop();
  const agent = agentInstances[0];

  agent.continue.mockImplementationOnce(async () => {
    agent.emit({
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "pwd" },
      partialResult: { details: { x: 1 } },
    });

    const assistantMessage = buildAssistantMessage("", Number.NaN);
    agent.state.messages = [assistantMessage];
  });

  const events = await collectEvents(loop, [{ role: "user", content: "ping" }]);
  expect(events.map((event) => event.type)).toEqual([
    "response.created",
    "response.output_text.done",
    "response.completed",
  ]);
  expect((events[2].output as { usage?: unknown }).usage).toBeUndefined();
});
