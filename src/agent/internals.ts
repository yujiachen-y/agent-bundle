import type {
  AgentLoop,
  ModelProvider,
  ResponseInput,
  ResponseOutput,
  ToolResult,
} from "../agent-loop/index.js";
import type { ExecResult, Sandbox } from "../sandbox/index.js";
import type { AgentStatus } from "./types.js";
import type { McpClientManager } from "./dependencies.js";

const MCP_TOOL_PREFIX = "mcp__";

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

export function toToolError(toolCallId: string, message: string): ToolResult {
  return {
    toolCallId,
    output: message,
    isError: true,
  };
}

export function toConversationInput(
  conversationHistory: ResponseInput,
  input: ResponseInput,
): ResponseInput {
  return [...conversationHistory, ...input];
}

export function toNextConversationHistory(
  runInput: ResponseInput,
  output: ResponseOutput,
): ResponseInput {
  return [
    ...runInput,
    {
      role: "assistant",
      content: output.output,
    },
  ];
}

export function extractRequiredString(
  input: Record<string, unknown>,
  fieldName: string,
): string | null {
  const value = input[fieldName];
  if (typeof value === "string") {
    return value;
  }

  return null;
}

export function extractRequiredNonEmptyString(
  input: Record<string, unknown>,
  fieldName: string,
): string | null {
  const value = input[fieldName];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
}

export function extractOptionalString(
  input: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const value = input[fieldName];
  if (value === undefined) {
    return undefined;
  }

  return typeof value === "string" ? value : undefined;
}

export function extractOptionalNumber(
  input: Record<string, unknown>,
  fieldName: string,
): number | undefined {
  const value = input[fieldName];
  if (value === undefined) {
    return undefined;
  }

  return typeof value === "number" ? value : undefined;
}

export function extractOptionalChunkHandler(
  input: Record<string, unknown>,
  fieldName: string,
): ((chunk: string) => void) | undefined {
  const value = input[fieldName];
  if (!isChunkHandler(value)) {
    return undefined;
  }

  return value;
}

function isChunkHandler(value: unknown): value is (chunk: string) => void {
  return typeof value === "function";
}

export function formatExecResult(result: ExecResult): string {
  const sections = [
    `exitCode: ${result.exitCode}`,
    result.stdout.length > 0 ? `stdout:\n${result.stdout}` : "stdout: (empty)",
    result.stderr.length > 0 ? `stderr:\n${result.stderr}` : "stderr: (empty)",
  ];
  return sections.join("\n\n");
}

export function readFieldError(
  toolCallId: string,
  toolName: string,
  fieldName: string,
): ToolResult {
  return toToolError(
    toolCallId,
    `${toolName} tool requires a non-empty string field \"${fieldName}\".`,
  );
}

export function readFieldTypeError(
  toolCallId: string,
  toolName: string,
  fieldName: string,
): ToolResult {
  return toToolError(
    toolCallId,
    `${toolName} tool requires a string field \"${fieldName}\".`,
  );
}

export async function disposeResources(
  loop: AgentLoop | null,
  mcpClientManager: McpClientManager | null,
  sandbox: Sandbox | null,
): Promise<void> {
  const failures: string[] = [];

  if (loop) {
    try {
      await loop.dispose();
    } catch (error) {
      failures.push(`loop.dispose failed: ${toErrorMessage(error)}`);
    }
  }

  if (mcpClientManager) {
    try {
      await mcpClientManager.dispose();
    } catch (error) {
      failures.push(`mcp.dispose failed: ${toErrorMessage(error)}`);
    }
  }

  if (sandbox) {
    try {
      await sandbox.shutdown();
    } catch (error) {
      failures.push(`sandbox.shutdown failed: ${toErrorMessage(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Agent shutdown encountered errors: ${failures.join(" | ")}`);
  }
}

export function ensureRunnableStatus(status: AgentStatus): void {
  if (status === "stopped") {
    throw new Error("Agent is stopped.");
  }

  if (status === "running") {
    throw new Error("Agent is already running.");
  }
}

export function isMcpTool(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}

const MODEL_PROVIDER_CREDENTIAL_ENVS: Partial<Record<ModelProvider, readonly string[]>> = {
  anthropic: ["ANTHROPIC_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

function applyModelCredentialAliases(provider: ModelProvider): void {
  if (
    provider === "anthropic"
    && (!process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_OAUTH_TOKEN.trim().length === 0)
    && process.env.CLAUDE_CODE_OAUTH_TOKEN
    && process.env.CLAUDE_CODE_OAUTH_TOKEN.trim().length > 0
  ) {
    process.env.ANTHROPIC_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }
}

export function validateModelApiKey(provider: ModelProvider): void {
  applyModelCredentialAliases(provider);

  const requiredEnvNames = MODEL_PROVIDER_CREDENTIAL_ENVS[provider];
  if (!requiredEnvNames || requiredEnvNames.length === 0) {
    // Ollama does not require an API key by default.
    return;
  }

  const hasCredential = requiredEnvNames.some((envName) => {
    const rawValue = process.env[envName];
    return typeof rawValue === "string" && rawValue.trim().length > 0;
  });
  if (hasCredential) {
    return;
  }

  throw new Error(
    `Missing credentials for provider "${provider}". Set ${requiredEnvNames.join(" or ")} before starting the agent.`,
  );
}
