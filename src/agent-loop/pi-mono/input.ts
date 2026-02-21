import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Api, AssistantMessage, Model, Usage } from "@mariozechner/pi-ai";

import type { ResponseInput, ResponseInputMessage } from "../types.js";
import { isRecord, toToolContent } from "./utils.js";

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function toPiToolName(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === "read" || normalized === "write" || normalized === "edit" || normalized === "bash") {
    return normalized;
  }

  return toolName;
}

function toAssistantHistoryMessage(
  message: Extract<ResponseInputMessage, { role: "assistant" }>,
  model: Model<Api>,
  timestamp: number,
): AssistantMessage {
  const textContent = message.content.trim().length > 0
    ? [{ type: "text" as const, text: message.content }]
    : [];
  const toolCallContent = (message.tool_calls ?? []).map((toolCall) => ({
    type: "toolCall" as const,
    id: toolCall.id,
    name: toPiToolName(toolCall.name),
    arguments: toolCall.input,
  }));

  return {
    role: "assistant",
    content: textContent.length + toolCallContent.length > 0
      ? [...textContent, ...toolCallContent]
      : [{ type: "text", text: "" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: toolCallContent.length > 0 ? "toolUse" : "stop",
    timestamp,
  };
}

function toToolResultHistoryMessages(
  message: Extract<ResponseInputMessage, { role: "tool" }>,
  timestamp: number,
): AgentMessage[] {
  if (message.tool_results.length === 0) {
    return [
      {
        role: "toolResult",
        toolCallId: `tool-${timestamp}`,
        toolName: "tool",
        content: [{ type: "text", text: toToolContent(undefined, message.content) }],
        details: undefined,
        isError: false,
        timestamp,
      },
    ];
  }

  return message.tool_results.map((toolResult, toolResultIndex) => ({
    role: "toolResult",
    toolCallId: toolResult.toolCallId,
    toolName: "tool",
    content: [{ type: "text", text: toToolContent(toolResult.output, message.content) }],
    details: toolResult.output,
    isError: Boolean(toolResult.isError),
    timestamp: timestamp + toolResultIndex,
  }));
}

function toAgentMessageArray(
  message: ResponseInputMessage,
  model: Model<Api>,
  timestamp: number,
): AgentMessage[] {
  if (message.role === "system") {
    return [];
  }

  if (message.role === "user") {
    return [{
      role: "user",
      content: [{ type: "text", text: message.content }],
      timestamp,
    }];
  }

  if (message.role === "assistant") {
    return [toAssistantHistoryMessage(message, model, timestamp)];
  }

  if (message.role === "tool") {
    return toToolResultHistoryMessages(message, timestamp);
  }

  return [];
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  if (!isRecord(message)) {
    return false;
  }

  return (
    message.role === "assistant"
    && Array.isArray(message.content)
    && typeof message.model === "string"
    && typeof message.provider === "string"
  );
}

export function toAgentMessages(input: ResponseInput, model: Model<Api>): AgentMessage[] {
  const baseTimestamp = Date.now();
  return input.flatMap((message, index) => {
    const timestamp = baseTimestamp + index * 100;
    return toAgentMessageArray(message, model, timestamp);
  });
}

export function getLatestAssistantMessage(messages: AgentMessage[]): AssistantMessage | null {
  const latestMessage = [...messages].reverse().find((message) => isAssistantMessage(message));
  return latestMessage ?? null;
}

export function toAssistantText(message: AssistantMessage | null): string {
  if (message === null) {
    return "";
  }

  return message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
}
