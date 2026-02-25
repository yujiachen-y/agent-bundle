import chalk from "chalk";

import type { ResponseEvent } from "../agent-loop/types.js";

export function renderEvent(event: ResponseEvent): string {
  switch (event.type) {
    case "response.output_text.delta":
      return event.delta;
    case "response.tool_call.created":
      return chalk.dim(`\n[tool: ${event.toolCall.name}] running...\n`);
    case "response.tool_call.done":
      return event.result.isError
        ? chalk.red(`[tool error] ${String(event.result.output)}\n`)
        : chalk.dim("[tool: done]\n");
    case "tool_execution_update":
      return chalk.dim(event.chunk);
    case "response.error":
      return chalk.red(`\nError: ${event.error}\n`);
    case "response.created":
    case "response.output_text.done":
    case "response.completed":
      return "";
  }
}

export function renderReady(agentName: string): string {
  return chalk.green(`Agent "${agentName}" is ready.\n`);
}

export function renderInterrupted(): string {
  return chalk.yellow("\n(Interrupted)\n");
}

export function renderShuttingDown(): string {
  return chalk.yellow("\nShutting down...\n");
}

export function renderExitHint(): string {
  return chalk.yellow("\n(Press Ctrl+C again to exit)\n");
}

export function renderError(message: string): string {
  return chalk.red(`\nError: ${message}\n`);
}

export function renderCommandNotFound(name: string): string {
  return chalk.red(`\nUnknown command: /${name}\n`);
}
