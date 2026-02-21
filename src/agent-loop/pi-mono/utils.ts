import type { TokenUsage } from "../types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isExecResultLike(value: unknown): value is {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.stdout === "string"
    && typeof value.stderr === "string"
    && typeof value.exitCode === "number"
  );
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (isExecResultLike(value)) {
    const sections = [
      `exitCode: ${value.exitCode}`,
      value.stdout.length > 0 ? `stdout:\n${value.stdout}` : "stdout: (empty)",
      value.stderr.length > 0 ? `stderr:\n${value.stderr}` : "stderr: (empty)",
    ];
    return sections.join("\n\n");
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function toToolOutputText(output: unknown): string {
  const text = stringifyUnknown(output).trim();
  return text.length > 0 ? text : "Tool completed with no output.";
}

export function toToolContent(output: unknown, fallbackText: string): string {
  const text = stringifyUnknown(output).trim();
  if (text.length > 0) {
    return text;
  }

  return fallbackText.trim().length > 0 ? fallbackText : "(empty tool result)";
}

export function toTokenUsage(
  usage: {
    input: number;
    output: number;
    totalTokens: number;
  } | undefined,
): TokenUsage | undefined {
  if (!usage) {
    return undefined;
  }

  if (
    !Number.isFinite(usage.input)
    || !Number.isFinite(usage.output)
    || !Number.isFinite(usage.totalTokens)
  ) {
    return undefined;
  }

  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
  };
}

export function toInputRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

export function requireStringField(
  input: Record<string, unknown>,
  fieldName: string,
  toolName: string,
): string {
  const value = input[fieldName];
  if (typeof value !== "string") {
    throw new Error(`Invalid ${toolName} tool input: field \"${fieldName}\" must be a string.`);
  }

  return value;
}

export function readNumberField(
  input: Record<string, unknown>,
  fieldName: string,
): number | undefined {
  const value = input[fieldName];
  return typeof value === "number" ? value : undefined;
}
