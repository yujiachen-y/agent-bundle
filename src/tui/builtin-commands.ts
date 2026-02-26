import chalk from "chalk";

import type { Agent } from "../agent/types.js";
import type { Command } from "../commands/types.js";

export type BuiltinContext = {
  write: (text: string) => void;
  close: () => void;
  clearScreen: () => void;
  agent: Agent;
  commands: readonly Command[];
};

export type BuiltinHandler = (ctx: BuiltinContext, args: string) => void;

export type BuiltinCommandDef = {
  description: string;
  aliases?: readonly string[];
  handler: BuiltinHandler;
};

function handleExit(ctx: BuiltinContext): void {
  ctx.close();
}

function handleClear(ctx: BuiltinContext): void {
  ctx.clearScreen();
}

function handleHelp(ctx: BuiltinContext): void {
  const lines: string[] = ["\n" + chalk.bold("Built-in commands:")];

  for (const [name, def] of BUILTIN_COMMANDS) {
    const alias = def.aliases?.length ? chalk.dim(` (/${def.aliases.join(", /")})`) : "";
    lines.push(`  ${chalk.cyan("/" + name)}${alias}  ${chalk.dim(def.description)}`);
  }

  if (ctx.commands.length > 0) {
    lines.push("\n" + chalk.bold("Agent commands:"));
    for (const cmd of ctx.commands) {
      const hint = cmd.argumentHint ? ` ${chalk.dim(cmd.argumentHint)}` : "";
      lines.push(`  ${chalk.cyan("/" + cmd.name)}${hint}  ${chalk.dim(cmd.description)}`);
    }
  }

  lines.push("");
  ctx.write(lines.join("\n") + "\n");
}

function handleCommands(ctx: BuiltinContext): void {
  if (ctx.commands.length === 0) {
    ctx.write(chalk.dim("\nNo agent commands configured.\n"));
    return;
  }

  const lines: string[] = ["\n" + chalk.bold("Agent commands:")];
  for (const cmd of ctx.commands) {
    const hint = cmd.argumentHint ? ` ${chalk.dim(cmd.argumentHint)}` : "";
    lines.push(`  ${chalk.cyan("/" + cmd.name)}${hint}  ${chalk.dim(cmd.description)}`);
  }
  lines.push("");
  ctx.write(lines.join("\n") + "\n");
}

function handleStatus(ctx: BuiltinContext): void {
  const status = ctx.agent.status;
  const color = status === "ready" ? chalk.green : status === "running" ? chalk.yellow : chalk.red;
  ctx.write(`\nAgent: ${chalk.bold(ctx.agent.name)}  Status: ${color(status)}\n`);
}

const BUILTIN_COMMANDS: ReadonlyMap<string, BuiltinCommandDef> = new Map([
  ["exit", { description: "Exit the TUI", aliases: ["quit", "q"], handler: handleExit }],
  ["clear", { description: "Clear the terminal screen", aliases: ["cls"], handler: handleClear }],
  ["help", { description: "Show available commands", aliases: ["?"], handler: handleHelp }],
  ["commands", { description: "List agent commands", handler: handleCommands }],
  ["status", { description: "Show agent status", handler: handleStatus }],
]);

const ALIAS_MAP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [name, def] of BUILTIN_COMMANDS) {
    if (def.aliases) {
      for (const alias of def.aliases) {
        map.set(alias.toLowerCase(), name);
      }
    }
  }
  return map;
})();

export function findBuiltinCommand(name: string): BuiltinCommandDef | undefined {
  const lower = name.toLowerCase();
  const resolved = ALIAS_MAP.get(lower) ?? lower;
  return BUILTIN_COMMANDS.get(resolved);
}

export function getBuiltinCommands(): ReadonlyMap<string, BuiltinCommandDef> {
  return BUILTIN_COMMANDS;
}

export function createSlashCompleter(
  commands: readonly Command[],
): (line: string) => [string[], string] {
  const allNames: string[] = [];
  for (const name of BUILTIN_COMMANDS.keys()) allNames.push(name);
  for (const alias of ALIAS_MAP.keys()) allNames.push(alias);
  for (const cmd of commands) allNames.push(cmd.name);

  return (line: string): [string[], string] => {
    if (!line.startsWith("/")) return [[], line];
    const partial = line.slice(1).toLowerCase();
    const hits = allNames
      .filter((n) => n.toLowerCase().startsWith(partial))
      .map((n) => "/" + n);
    return [hits.length > 0 ? hits : allNames.map((n) => "/" + n), line];
  };
}
