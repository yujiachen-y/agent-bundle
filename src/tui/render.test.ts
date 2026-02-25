import { expect, it } from "vitest";

import type { ResponseEvent } from "../agent-loop/types.js";

import {
  renderCommandNotFound,
  renderError,
  renderEvent,
  renderExitHint,
  renderInterrupted,
  renderReady,
  renderShuttingDown,
} from "./render.js";

it("renderEvent returns delta text for output_text.delta", () => {
  const event: ResponseEvent = { type: "response.output_text.delta", delta: "Hello world" };
  expect(renderEvent(event)).toBe("Hello world");
});

it("renderEvent returns empty string for response.created", () => {
  const event: ResponseEvent = { type: "response.created", responseId: "r1" };
  expect(renderEvent(event)).toBe("");
});

it("renderEvent returns empty string for response.output_text.done", () => {
  const event: ResponseEvent = { type: "response.output_text.done", text: "full text" };
  expect(renderEvent(event)).toBe("");
});

it("renderEvent returns empty string for response.completed", () => {
  const event: ResponseEvent = {
    type: "response.completed",
    output: { id: "r1", output: "done" },
  };
  expect(renderEvent(event)).toBe("");
});

it("renderEvent renders tool call created with tool name", () => {
  const event: ResponseEvent = {
    type: "response.tool_call.created",
    toolCall: { id: "tc1", name: "Bash", input: { command: "ls" } },
  };
  const result = renderEvent(event);
  expect(result).toContain("[tool: Bash]");
  expect(result).toContain("running...");
});

it("renderEvent renders tool call done success as dim", () => {
  const event: ResponseEvent = {
    type: "response.tool_call.done",
    result: { toolCallId: "tc1", output: "ok" },
  };
  const result = renderEvent(event);
  expect(result).toContain("[tool: done]");
});

it("renderEvent renders tool call done error in red", () => {
  const event: ResponseEvent = {
    type: "response.tool_call.done",
    result: { toolCallId: "tc1", output: "command not found", isError: true },
  };
  const result = renderEvent(event);
  expect(result).toContain("[tool error]");
  expect(result).toContain("command not found");
});

it("renderEvent renders tool_execution_update with chunk content", () => {
  const event: ResponseEvent = {
    type: "tool_execution_update",
    toolCallId: "tc1",
    chunk: "line 1\nline 2\n",
  };
  const result = renderEvent(event);
  expect(result).toContain("line 1");
  expect(result).toContain("line 2");
});

it("renderEvent renders response.error with error message", () => {
  const event: ResponseEvent = { type: "response.error", error: "LLM timeout" };
  const result = renderEvent(event);
  expect(result).toContain("Error:");
  expect(result).toContain("LLM timeout");
});

it("renderReady contains agent name and ready", () => {
  const result = renderReady("invoice-processor");
  expect(result).toContain("invoice-processor");
  expect(result).toContain("ready");
});

it("renderInterrupted contains Interrupted", () => {
  expect(renderInterrupted()).toContain("Interrupted");
});

it("renderShuttingDown contains Shutting down", () => {
  expect(renderShuttingDown()).toContain("Shutting down");
});

it("renderExitHint contains Ctrl+C instruction", () => {
  expect(renderExitHint()).toContain("Ctrl+C");
  expect(renderExitHint()).toContain("exit");
});

it("renderError contains error message", () => {
  const result = renderError("something went wrong");
  expect(result).toContain("Error:");
  expect(result).toContain("something went wrong");
});

it("renderCommandNotFound returns formatted error with command name", () => {
  const result = renderCommandNotFound("foobar");
  expect(result).toContain("Unknown command");
  expect(result).toContain("/foobar");
});
