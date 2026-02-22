import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";

import type { ResponseEvent, ResponseInput } from "../agent-loop/types.js";
import type { Agent, AgentStatus } from "../agent/types.js";

import { determineSigintAction, serveTUI } from "./tui.js";

function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FakeAgentOptions = {
  events?: ResponseEvent[];
  respondStreamFn?: (input: ResponseInput) => AsyncIterable<ResponseEvent>;
  respondStreamError?: Error;
};

function createFakeAgent(options: FakeAgentOptions = {}): Agent {
  const events = options.events ?? [
    { type: "response.created", responseId: "r1" },
    { type: "response.output_text.delta", delta: "Hello" },
    { type: "response.completed", output: { id: "r1", output: "Hello" } },
  ];

  const respondStreamFn =
    options.respondStreamFn ??
    (options.respondStreamError
      ? async function* (): AsyncIterable<ResponseEvent> {
          throw options.respondStreamError;
        }
      : async function* (): AsyncIterable<ResponseEvent> {
          for (const event of events) {
            yield event;
          }
        });

  return {
    name: "test-agent",
    get status(): AgentStatus {
      return "ready";
    },
    respond: vi.fn(),
    respondStream: vi.fn().mockImplementation(respondStreamFn),
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

// --- determineSigintAction tests ---

it("determineSigintAction returns ignore when shutting_down", () => {
  expect(determineSigintAction("shutting_down", false, 5000)).toBe("ignore");
});

it("determineSigintAction returns ignore when shutting_down even with abort", () => {
  expect(determineSigintAction("shutting_down", true, 100)).toBe("ignore");
});

it("determineSigintAction returns abort when streaming with active abort", () => {
  expect(determineSigintAction("streaming", true, 5000)).toBe("abort");
});

it("determineSigintAction returns shutdown on rapid double Ctrl+C while streaming", () => {
  expect(determineSigintAction("streaming", true, 500)).toBe("shutdown");
});

it("determineSigintAction returns exit_hint when streaming without abort", () => {
  expect(determineSigintAction("streaming", false, 5000)).toBe("exit_hint");
});

it("determineSigintAction returns shutdown on rapid double Ctrl+C from idle", () => {
  expect(determineSigintAction("idle", false, 500)).toBe("shutdown");
});

it("determineSigintAction returns exit_hint on first Ctrl+C from idle", () => {
  expect(determineSigintAction("idle", false, 5000)).toBe("exit_hint");
});

it("determineSigintAction returns shutdown when time since last is exactly zero", () => {
  expect(determineSigintAction("idle", false, 0)).toBe("shutdown");
});

it("determineSigintAction returns exit_hint at exactly the threshold", () => {
  expect(determineSigintAction("idle", false, 1000)).toBe("exit_hint");
});

// --- serveTUI integration tests ---

it("prints ready message on start", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  env.input.end();
  await tuiPromise;

  expect(env.getOutput()).toContain("test-agent");
  expect(env.getOutput()).toContain("ready");
});

it("shows prompt after ready message", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  env.input.end();
  await tuiPromise;

  expect(env.getOutput()).toContain("> ");
});

it("ignores empty input and re-prompts", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  env.writeLine("   ");
  await tick();

  env.input.end();
  await tuiPromise;

  expect(agent.respondStream).not.toHaveBeenCalled();
});

it("drops input while streaming to prevent concurrent handleLine", async () => {
  let resolveStream: (() => void) | undefined;
  const streamBlock = new Promise<void>((r) => {
    resolveStream = r;
  });

  const agent = createFakeAgent({
    respondStreamFn: async function* (): AsyncIterable<ResponseEvent> {
      yield { type: "response.created", responseId: "r1" };
      await streamBlock;
      yield { type: "response.completed", output: { id: "r1", output: "done" } };
    },
  });
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  // First line starts streaming
  env.writeLine("first");
  await tick();
  expect(agent.respondStream).toHaveBeenCalledTimes(1);

  // Second line while streaming should be dropped
  env.writeLine("second");
  await tick();
  expect(agent.respondStream).toHaveBeenCalledTimes(1);

  // Unblock the stream and close
  resolveStream?.();
  await tick();

  env.input.end();
  await tuiPromise;
});

it("passes user input to agent.respondStream", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  env.writeLine("Extract invoices");
  await tick();

  env.input.end();
  await tuiPromise;

  expect(agent.respondStream).toHaveBeenCalledWith(
    [{ role: "user", content: "Extract invoices" }],
    { signal: expect.any(AbortSignal) },
  );
});

it("renders streamed text deltas to output", async () => {
  const agent = createFakeAgent({
    events: [
      { type: "response.created", responseId: "r1" },
      { type: "response.output_text.delta", delta: "Found " },
      { type: "response.output_text.delta", delta: "3 items." },
      { type: "response.completed", output: { id: "r1", output: "Found 3 items." } },
    ],
  });
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  env.writeLine("query");
  await tick();

  env.input.end();
  await tuiPromise;

  const out = env.getOutput();
  expect(out).toContain("Found ");
  expect(out).toContain("3 items.");
});

it("renders tool execution events inline", async () => {
  const agent = createFakeAgent({
    events: [
      { type: "response.created", responseId: "r1" },
      {
        type: "response.tool_call.created",
        toolCall: { id: "tc1", name: "Bash", input: { command: "ls" } },
      },
      { type: "tool_execution_update", toolCallId: "tc1", chunk: "file1.txt\n" },
      {
        type: "response.tool_call.done",
        result: { toolCallId: "tc1", output: "file1.txt" },
      },
      { type: "response.output_text.delta", delta: "Done." },
      { type: "response.completed", output: { id: "r1", output: "Done." } },
    ],
  });
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  env.writeLine("list files");
  await tick();

  env.input.end();
  await tuiPromise;

  const out = env.getOutput();
  expect(out).toContain("[tool: Bash]");
  expect(out).toContain("file1.txt");
  expect(out).toContain("[tool: done]");
  expect(out).toContain("Done.");
});

it("displays error when respondStream throws", async () => {
  const agent = createFakeAgent({
    respondStreamError: new Error("LLM connection failed"),
  });
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  env.writeLine("query");
  await tick();

  env.input.end();
  await tuiPromise;

  expect(env.getOutput()).toContain("LLM connection failed");
});

it("calls agent.shutdown when input stream ends", async () => {
  const agent = createFakeAgent();
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  env.input.end();
  await tuiPromise;

  expect(agent.shutdown).toHaveBeenCalled();
});

it("renders tool call error with error indicator", async () => {
  const agent = createFakeAgent({
    events: [
      { type: "response.created", responseId: "r1" },
      {
        type: "response.tool_call.created",
        toolCall: { id: "tc1", name: "Bash", input: { command: "bad-cmd" } },
      },
      {
        type: "response.tool_call.done",
        result: { toolCallId: "tc1", output: "command not found", isError: true },
      },
      { type: "response.completed", output: { id: "r1", output: "" } },
    ],
  });
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  env.writeLine("run bad command");
  await tick();

  env.input.end();
  await tuiPromise;

  const out = env.getOutput();
  expect(out).toContain("[tool error]");
  expect(out).toContain("command not found");
});

it("renders response.error events", async () => {
  const agent = createFakeAgent({
    events: [
      { type: "response.created", responseId: "r1" },
      { type: "response.error", error: "rate limit exceeded" },
    ],
  });
  const env = createTUIEnv();

  const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
  await tick();

  env.writeLine("hello");
  await tick();

  env.input.end();
  await tuiPromise;

  expect(env.getOutput()).toContain("rate limit exceeded");
});
