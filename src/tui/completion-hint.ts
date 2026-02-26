import chalk from "chalk";

import type { Interface as ReadlineInterface } from "node:readline";

import type { Command } from "../commands/types.js";

import { getBuiltinCommands } from "./builtin-commands.js";

export type HintEntry = {
  name: string;
  description: string;
  aliases?: string;
};

const MAX_HINT_LINES = 8;

export function buildHintEntries(commands: readonly Command[]): HintEntry[] {
  const entries: HintEntry[] = [];
  for (const [name, def] of getBuiltinCommands()) {
    const aliasList = def.aliases?.length ? def.aliases.map((a) => `/${a}`).join(", ") : undefined;
    entries.push({ name, description: def.description, aliases: aliasList });
  }
  for (const cmd of commands) {
    entries.push({ name: cmd.name, description: cmd.description });
  }
  return entries;
}

export function matchHintEntries(entries: readonly HintEntry[], partial: string): HintEntry[] {
  if (partial.length === 0) return [...entries];
  const lower = partial.toLowerCase();
  return entries.filter((e) => e.name.toLowerCase().startsWith(lower));
}

export function formatHintLines(matches: readonly HintEntry[]): string[] {
  const shown = matches.slice(0, MAX_HINT_LINES);
  const maxLen = Math.max(...shown.map((e) => e.name.length));
  return shown.map((e) => {
    const padded = e.name.padEnd(maxLen);
    const alias = e.aliases ? chalk.dim(` (${e.aliases})`) : "";
    return `  ${chalk.cyan("/" + padded)}  ${chalk.dim(e.description)}${alias}`;
  });
}

function buildClearSequence(lineCount: number): string {
  let seq = "\x1b7";
  for (let i = 0; i < lineCount; i++) seq += "\n\x1b[2K";
  seq += "\x1b8";
  return seq;
}

function buildRenderSequence(lines: string[]): string {
  let seq = "\x1b7";
  for (const line of lines) seq += "\n\x1b[2K" + line;
  seq += "\x1b8";
  return seq;
}

export function attachCompletionHint(
  rl: ReadlineInterface,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  commands: readonly Command[],
): () => void {
  const entries = buildHintEntries(commands);
  let renderedCount = 0;

  function clearRendered(): void {
    if (renderedCount === 0) return;
    output.write(buildClearSequence(renderedCount));
    renderedCount = 0;
  }

  function update(line: string): void {
    if (!line.startsWith("/") || line.includes(" ")) {
      clearRendered();
      return;
    }
    const partial = line.slice(1);
    const matches = matchHintEntries(entries, partial);
    const isExact = matches.length === 1 && matches[0].name.toLowerCase() === partial.toLowerCase();
    if (matches.length === 0 || isExact) {
      clearRendered();
      return;
    }
    clearRendered();
    const lines = formatHintLines(matches);
    output.write(buildRenderSequence(lines));
    renderedCount = lines.length;
  }

  function onKeypress(): void {
    process.nextTick(() => update(rl.line));
  }

  input.on("keypress", onKeypress);

  return () => {
    clearRendered();
    input.removeListener("keypress", onKeypress);
  };
}
