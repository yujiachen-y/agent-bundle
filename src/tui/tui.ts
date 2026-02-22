import * as readline from "node:readline";

import type { ResponseEvent, ResponseInput } from "../agent-loop/types.js";
import type { Agent } from "../agent/types.js";

import {
  renderError,
  renderEvent,
  renderExitHint,
  renderInterrupted,
  renderReady,
  renderShuttingDown,
} from "./render.js";

export type TUIOptions = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

type TUIState = "idle" | "streaming" | "shutting_down";

export type SigintAction = "ignore" | "abort" | "shutdown" | "exit_hint";

const DOUBLE_CTRL_C_MS = 1000;
const PROMPT = "> ";

export function determineSigintAction(
  state: TUIState,
  hasAbort: boolean,
  msSinceLastCtrlC: number,
): SigintAction {
  if (state === "shutting_down") return "ignore";
  if (msSinceLastCtrlC < DOUBLE_CTRL_C_MS) return "shutdown";
  if (state === "streaming" && hasAbort) return "abort";
  return "exit_hint";
}

export async function serveTUI(agent: Agent, options?: TUIOptions): Promise<void> {
  const input = options?.input ?? process.stdin;
  const output = options?.output ?? process.stdout;

  let state: TUIState = "idle";
  let lastCtrlCTime = 0;
  let currentAbort: AbortController | null = null;

  // Reads current state without TypeScript narrowing. Needed because `state` is
  // mutated from both the line handler and the SIGINT handler closures; TS
  // cannot track cross-closure mutations and produces false TS2367 errors.
  const readState = (): TUIState => state;

  const rl = readline.createInterface({ input, output, prompt: PROMPT });
  const write = (text: string): void => {
    output.write(text);
  };

  write(renderReady(agent.name));
  rl.prompt();

  const handleLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      rl.prompt();
      return;
    }

    if (readState() !== "idle") return;

    state = "streaming";
    const abort = new AbortController();
    currentAbort = abort;
    const userInput: ResponseInput = [{ role: "user", content: trimmed }];

    try {
      for await (const event of agent.respondStream(userInput, { signal: abort.signal })) {
        if (abort.signal.aborted) break;
        const text = renderEvent(event);
        if (text.length > 0) write(text);
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        write(renderError(error instanceof Error ? error.message : "Unknown error"));
      }
    } finally {
      currentAbort = null;
      if (readState() !== "shutting_down") {
        state = "idle";
        write("\n");
        rl.prompt();
      }
    }
  };

  rl.on("line", (line: string) => {
    void handleLine(line);
  });

  rl.on("SIGINT", () => {
    const now = Date.now();
    const action = determineSigintAction(readState(), currentAbort !== null, now - lastCtrlCTime);

    switch (action) {
      case "ignore":
        return;
      case "abort":
        lastCtrlCTime = now;
        currentAbort?.abort();
        write(renderInterrupted());
        return;
      case "shutdown":
        state = "shutting_down";
        write(renderShuttingDown());
        agent.shutdown().finally(() => {
          rl.close();
        });
        return;
      case "exit_hint":
        lastCtrlCTime = now;
        write(renderExitHint());
        rl.prompt();
        return;
    }
  });

  return new Promise<void>((resolve) => {
    rl.on("close", () => {
      if (readState() !== "shutting_down") {
        agent.shutdown().then(resolve, resolve);
      } else {
        resolve();
      }
    });
  });
}

export type { ResponseEvent, ResponseInput };
