import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";

import type { ResponseEvent } from "../agent-loop/types.js";
import type { Agent, AgentStatus } from "../agent/types.js";

import { serveTUI } from "./tui.js";

function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeAgent(): Agent {
  const events: ResponseEvent[] = [
    { type: "response.created", responseId: "r1" },
    { type: "response.output_text.delta", delta: "Hello" },
    { type: "response.completed", output: { id: "r1", output: "Hello" } },
  ];

  return {
    name: "test-agent",
    get status(): AgentStatus {
      return "ready";
    },
    respond: vi.fn(),
    respondStream: vi.fn().mockImplementation(async function* (): AsyncIterable<ResponseEvent> {
      for (const event of events) yield event;
    }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function createTUIEnv(): {
  input: PassThrough;
  output: PassThrough;
  getOutput: () => string;
  writeLine: (text: string) => void;
} {
  const input = new PassThrough();
  const chunks: string[] = [];
  const output = new PassThrough();
  output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));

  return {
    input,
    output,
    getOutput: () => chunks.join(""),
    writeLine: (text: string) => {
      input.write(`${text}\n`);
    },
  };
}

it("handles /exit by closing the TUI and shutting down", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();
  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();
  env.writeLine("/exit");
  await tuiPromise;
  expect(agent.shutdown).toHaveBeenCalled();
  expect(agent.respondStream).not.toHaveBeenCalled();
});

it("handles /quit alias for exit", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();
  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();
  env.writeLine("/quit");
  await tuiPromise;
  expect(agent.shutdown).toHaveBeenCalled();
  expect(agent.respondStream).not.toHaveBeenCalled();
});

it("handles /status without sending to agent", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();
  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();
  env.writeLine("/status");
  await tick();
  env.input.end();
  await tuiPromise;
  expect(env.getOutput()).toContain("test-agent");
  expect(agent.respondStream).not.toHaveBeenCalled();
});

it("handles /help without sending to agent", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();
  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();
  env.writeLine("/help");
  await tick();
  env.input.end();
  await tuiPromise;
  expect(env.getOutput()).toContain("Built-in commands");
  expect(agent.respondStream).not.toHaveBeenCalled();
});

it("builtin commands take priority over user-defined commands", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();
  const commands = [
    { name: "help", description: "User help", content: "custom $ARGUMENTS", sourcePath: "t.md" },
  ];
  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output, commands });
  await tick();
  env.writeLine("/help");
  await tick();
  env.input.end();
  await tuiPromise;
  expect(agent.respondStream).not.toHaveBeenCalled();
  expect(env.getOutput()).toContain("Built-in commands");
});

it("handles /clear by writing ANSI clear sequence", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();
  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();
  env.writeLine("/clear");
  await tick();
  env.input.end();
  await tuiPromise;
  expect(env.getOutput()).toContain("\x1b[2J");
  expect(agent.respondStream).not.toHaveBeenCalled();
});
