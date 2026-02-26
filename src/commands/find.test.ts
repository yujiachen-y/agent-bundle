import { describe, expect, it } from "vitest";

import { findCommand, toCommandSummary } from "./find.js";
import type { Command } from "./types.js";

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    name: "analyze",
    description: "Run analysis",
    content: "Analyze $ARGUMENTS",
    sourcePath: "/commands/analyze.md",
    ...overrides,
  };
}

describe("findCommand", () => {
  it("finds by exact name match", () => {
    const commands = [makeCommand({ name: "Analyze" })];
    expect(findCommand(commands, "Analyze")?.name).toBe("Analyze");
  });

  it("finds by case-insensitive match", () => {
    const commands = [makeCommand({ name: "Analyze" })];
    expect(findCommand(commands, "analyze")?.name).toBe("Analyze");
  });

  it("returns undefined when no command matches", () => {
    const commands = [makeCommand({ name: "analyze" })];
    expect(findCommand(commands, "nonexistent")).toBeUndefined();
  });

  it("returns undefined for empty commands list", () => {
    expect(findCommand([], "analyze")).toBeUndefined();
  });
});

describe("toCommandSummary", () => {
  it("includes argumentHint when present", () => {
    const command = makeCommand({ argumentHint: "<ticker>" });
    expect(toCommandSummary(command)).toEqual({
      name: "analyze",
      description: "Run analysis",
      argumentHint: "<ticker>",
    });
  });

  it("omits argumentHint when not present", () => {
    const command = makeCommand();
    const summary = toCommandSummary(command);
    expect(summary).toEqual({
      name: "analyze",
      description: "Run analysis",
    });
    expect("argumentHint" in summary).toBe(false);
  });
});
