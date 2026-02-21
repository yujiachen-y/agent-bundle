import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  bashTool as piBashTool,
  editTool as piEditTool,
  readTool as piReadTool,
  writeTool as piWriteTool,
} from "@mariozechner/pi-coding-agent";

import type { ToolHandler } from "../agent-loop.js";
import {
  isRecord,
  readNumberField,
  requireStringField,
  toInputRecord,
  toToolOutputText,
} from "./utils.js";

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
  name: "read" | "write" | "bash",
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

function toReadOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  if (isRecord(output) && typeof output.content === "string") {
    return output.content;
  }

  throw new Error("Read tool returned non-text output. Edit requires full text file content.");
}

function replaceTextExactlyOnce(
  fileContent: string,
  oldText: string,
  newText: string,
  path: string,
): string {
  if (!fileContent.includes(oldText)) {
    throw new Error(
      `Could not find the exact text in ${path}. The old text must match exactly including whitespace and newlines.`,
    );
  }

  const occurrences = fileContent.split(oldText).length - 1;
  if (occurrences > 1) {
    throw new Error(
      `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
    );
  }

  const index = fileContent.indexOf(oldText);
  const updatedContent = fileContent.substring(0, index)
    + newText
    + fileContent.substring(index + oldText.length);

  if (updatedContent === fileContent) {
    throw new Error(
      `No changes made to ${path}. The replacement produced identical content.`,
    );
  }

  return updatedContent;
}

function createEditTool(toolHandler: ToolHandler): AgentTool {
  return {
    name: "edit",
    label: "edit",
    description: piEditTool.description,
    parameters: piEditTool.parameters,
    execute: async (toolCallId, rawInput): Promise<AgentToolResult<unknown>> => {
      const input = toInputRecord(rawInput);
      const path = requireStringField(input, "path", "edit");
      const oldText = requireStringField(input, "oldText", "edit");
      const newText = requireStringField(input, "newText", "edit");

      const readResult = await toolHandler({
        id: `${toolCallId}:read`,
        name: "Read",
        input: { path },
      });

      if (readResult.isError) {
        throw new Error(toToolOutputText(readResult.output));
      }

      const fileContent = toReadOutputText(readResult.output);
      const updatedContent = replaceTextExactlyOnce(fileContent, oldText, newText, path);

      const writeResult = await toolHandler({
        id: `${toolCallId}:write`,
        name: "Write",
        input: {
          path,
          content: updatedContent,
        },
      });

      if (writeResult.isError) {
        throw new Error(toToolOutputText(writeResult.output));
      }

      return {
        content: [{
          type: "text",
          text: `Successfully replaced text in ${path}. Changed ${oldText.length} characters to ${newText.length} characters.`,
        }],
        details: {
          oldLength: fileContent.length,
          newLength: updatedContent.length,
        },
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
    createEditTool(toolHandler),
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
