import type { AgentEvent } from "@mariozechner/pi-agent-core";

import type { ResponseEvent, ToolCall, ToolResult } from "../types.js";
import { toInputRecord } from "./utils.js";
import { toBundleToolCallName } from "./tools.js";

function toToolCallEvent(toolCallId: string, toolName: string, args: unknown): ToolCall {
  return {
    id: toolCallId,
    name: toBundleToolCallName(toolName),
    input: toInputRecord(args),
  };
}

function toToolResultEvent(toolCallId: string, result: unknown, isError: boolean): ToolResult {
  return {
    toolCallId,
    output: result,
    isError,
  };
}

function toToolUpdateChunk(partialResult: unknown): string {
  if (
    typeof partialResult !== "object"
    || partialResult === null
    || !Object.hasOwn(partialResult, "content")
  ) {
    return "";
  }

  const content = Reflect.get(partialResult, "content");
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((item) => {
      if (typeof item !== "object" || item === null) {
        return false;
      }

      return Reflect.get(item, "type") === "text" && typeof Reflect.get(item, "text") === "string";
    })
    .map((item) => {
      return typeof item === "object" && item !== null
        ? String(Reflect.get(item, "text"))
        : "";
    })
    .join("");
}

export function toResponseEvent(event: AgentEvent): ResponseEvent | null {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    return {
      type: "response.output_text.delta",
      delta: event.assistantMessageEvent.delta,
    };
  }

  if (event.type === "tool_execution_start") {
    return {
      type: "response.tool_call.created",
      toolCall: toToolCallEvent(event.toolCallId, event.toolName, event.args),
    };
  }

  if (event.type === "tool_execution_update") {
    const chunk = toToolUpdateChunk(event.partialResult);
    if (chunk.length === 0) {
      return null;
    }

    return {
      type: "tool_execution_update",
      toolCallId: event.toolCallId,
      chunk,
    };
  }

  if (event.type === "tool_execution_end") {
    return {
      type: "response.tool_call.done",
      result: toToolResultEvent(event.toolCallId, event.result, event.isError),
    };
  }

  return null;
}
