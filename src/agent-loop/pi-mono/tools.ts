import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  bashTool as piBashTool,
  editTool as piEditTool,
  readTool as piReadTool,
  writeTool as piWriteTool,
} from "@mariozechner/pi-coding-agent";

import type { ToolHandler } from "../agent-loop.js";
import { readNumberField, requireStringField, toInputRecord, toToolOutputText } from "./utils.js";

function toBundleToolName(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === "read") {
    return "Read";
  }
  if (normalized === "write") {
    return "Write";
  }
  if (normalized === "edit") {
    return "Edit";
  }
  if (normalized === "bash") {
    return "Bash";
  }

  return toolName;
}

function createTool(
  name: "read" | "write" | "edit" | "bash",
  description: string,
  parameters: AgentTool["parameters"],
  toHandlerInput: (input: Record<string, unknown>) => Record<string, unknown>,
  toolHandler: ToolHandler,
): AgentTool {
  return {
    name,
    label: name,
    description,
    parameters,
    execute: async (toolCallId, rawInput): Promise<AgentToolResult<unknown>> => {
      const input = toHandlerInput(toInputRecord(rawInput));
      const toolResult = await toolHandler({
        id: toolCallId,
        name: toBundleToolName(name),
        input,
      });

      if (toolResult.isError) {
        throw new Error(toToolOutputText(toolResult.output));
      }

      return {
        content: [{ type: "text", text: toToolOutputText(toolResult.output) }],
        details: toolResult.output,
      };
    },
  };
}

export function createPiTools(toolHandler: ToolHandler): AgentTool[] {
  return [
    createTool(
      "read",
      piReadTool.description,
      piReadTool.parameters,
      (input) => ({
        path: requireStringField(input, "path", "read"),
        offset: readNumberField(input, "offset"),
        limit: readNumberField(input, "limit"),
      }),
      toolHandler,
    ),
    createTool(
      "write",
      piWriteTool.description,
      piWriteTool.parameters,
      (input) => ({
        path: requireStringField(input, "path", "write"),
        content: requireStringField(input, "content", "write"),
      }),
      toolHandler,
    ),
    createTool(
      "edit",
      piEditTool.description,
      piEditTool.parameters,
      (input) => ({
        path: requireStringField(input, "path", "edit"),
        oldText: requireStringField(input, "oldText", "edit"),
        newText: requireStringField(input, "newText", "edit"),
      }),
      toolHandler,
    ),
    createTool(
      "bash",
      piBashTool.description,
      piBashTool.parameters,
      (input) => ({
        command: requireStringField(input, "command", "bash"),
        timeout: readNumberField(input, "timeout"),
      }),
      toolHandler,
    ),
  ];
}

export function toBundleToolCallName(toolName: string): string {
  return toBundleToolName(toolName);
}
