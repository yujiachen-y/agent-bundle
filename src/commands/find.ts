import type { Command } from "./types.js";

export type CommandSummary = {
  name: string;
  description: string;
  argumentHint?: string;
};

export function findCommand(
  commands: readonly Command[],
  name: string,
): Command | undefined {
  return commands.find(
    (cmd) => cmd.name === name || cmd.name.toLowerCase() === name.toLowerCase(),
  );
}

export function toCommandSummary(command: Command): CommandSummary {
  return {
    name: command.name,
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
  };
}
