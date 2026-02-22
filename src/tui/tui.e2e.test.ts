import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { PiMonoAgentLoop } from "../agent-loop/pi-mono/pi-mono-loop.js";
import type { AgentLoop, ResponseEvent, ResponseInput, ToolResult } from "../agent-loop/types.js";
import type { Agent, AgentStatus } from "../agent/types.js";

import { serveTUI } from "./tui.js";

const E2E_ENABLED = process.env.TUI_E2E === "1";
const describeIfE2E = E2E_ENABLED ? describe : describe.skip;
const hasOpenAiKey =
  typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0;
const itIfOpenAi = hasOpenAiKey ? it : it.skip;

function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a lightweight Agent backed by a real PiMonoAgentLoop.
 * No sandbox — tool calls return a stub result.
 */
function createLiveAgent(model: { provider: "openai"; model: string }): Agent {
  let loop: AgentLoop | null = null;
  let status: AgentStatus = "stopped";

  const toolHandler = async (call: { id: string; name: string }): Promise<ToolResult> => ({
    toolCallId: call.id,
    output: `[stub] tool ${call.name} not available in TUI e2e`,
    isError: true,
  });

  return {
    name: "tui-e2e-agent",
    get status() {
      return status;
    },

    respond: async () => {
      throw new Error("Use respondStream for TUI e2e");
    },

    respondStream: async function* (input: ResponseInput): AsyncIterable<ResponseEvent> {
      if (!loop) {
        loop = new PiMonoAgentLoop();
        await loop.init({
          systemPrompt: "You are concise. Always respond in one sentence.",
          model,
          toolHandler,
        });
        status = "ready";
      }

      for await (const event of loop.run(input)) {
        yield event;
      }
    },

    shutdown: async () => {
      if (loop) {
        await loop.dispose();
        loop = null;
      }
      status = "stopped";
    },
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

describeIfE2E("TUI E2E", () => {
  itIfOpenAi(
    "streams a real LLM response through the TUI",
    async () => {
      const openAiModel = process.env.TUI_E2E_OPENAI_MODEL ?? "gpt-4o-mini";
      const agent = createLiveAgent({ provider: "openai", model: openAiModel });
      const env = createTUIEnv();

      const tuiPromise = serveTUI(agent, { input: env.input, output: env.output });
      await tick(100);

      // Verify ready message
      expect(env.getOutput()).toContain("tui-e2e-agent");
      expect(env.getOutput()).toContain("ready");

      // Send a prompt and wait for the LLM response
      env.writeLine("Say exactly: tui-e2e-ok");
      await tick(15_000);

      const output = env.getOutput();
      expect(output.toLowerCase()).toContain("tui-e2e-ok");

      // Clean up
      env.input.end();
      await tuiPromise;

      expect(agent.status).toBe("stopped");
    },
    60_000,
  );
});
