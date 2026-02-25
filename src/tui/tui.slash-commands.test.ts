import { expect, it } from "vitest";

import type { Command } from "../commands/types.js";

import { parseSlashCommand, resolveSlashInput } from "./tui.js";

// --- parseSlashCommand tests ---

it("parseSlashCommand parses /command-name args", () => {
  const result = parseSlashCommand("/analyze AAPL Q3");
  expect(result).toEqual({ commandName: "analyze", args: "AAPL Q3" });
});

it("parseSlashCommand parses command without args", () => {
  const result = parseSlashCommand("/help");
  expect(result).toEqual({ commandName: "help", args: "" });
});

it("parseSlashCommand returns null for empty slash /", () => {
  expect(parseSlashCommand("/")).toBeNull();
});

it("parseSlashCommand returns null for non-slash input", () => {
  expect(parseSlashCommand("regular text")).toBeNull();
});

// --- resolveSlashInput tests ---

function makeTestCommand(overrides: Partial<Command> = {}): Command {
  return {
    name: "analyze",
    description: "Run analysis",
    content: "Analyze $ARGUMENTS now.",
    sourcePath: "test.md",
    ...overrides,
  };
}

it("resolveSlashInput returns substituted content for known command", () => {
  const commands = [makeTestCommand()];
  const writes: string[] = [];
  const result = resolveSlashInput("/analyze AAPL", commands, (t) => writes.push(t));
  expect(result).toBe("Analyze AAPL now.");
  expect(writes).toHaveLength(0);
});

it("resolveSlashInput returns null for unknown command", () => {
  const commands = [makeTestCommand()];
  const writes: string[] = [];
  const result = resolveSlashInput("/unknown", commands, (t) => writes.push(t));
  expect(result).toBeNull();
  expect(writes[0]).toContain("unknown");
});

it("resolveSlashInput returns original text for non-slash input", () => {
  const commands = [makeTestCommand()];
  const writes: string[] = [];
  const result = resolveSlashInput("plain input", commands, (t) => writes.push(t));
  expect(result).toBe("plain input");
  expect(writes).toHaveLength(0);
});
