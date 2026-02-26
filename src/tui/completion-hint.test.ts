import { expect, it } from "vitest";

import type { Command } from "../commands/types.js";

import {
  buildHintEntries,
  formatHintLines,
  matchHintEntries,
} from "./completion-hint.js";

// --- buildHintEntries ---

it("buildHintEntries includes builtin commands", () => {
  const entries = buildHintEntries([]);
  const names = entries.map((e) => e.name);
  expect(names).toContain("exit");
  expect(names).toContain("help");
  expect(names).toContain("clear");
  expect(names).toContain("commands");
  expect(names).toContain("status");
});

it("buildHintEntries includes alias info", () => {
  const entries = buildHintEntries([]);
  const exitEntry = entries.find((e) => e.name === "exit");
  expect(exitEntry?.aliases).toContain("/quit");
  expect(exitEntry?.aliases).toContain("/q");
});

it("buildHintEntries includes user commands", () => {
  const commands: Command[] = [
    { name: "deploy", description: "Deploy app", content: "...", sourcePath: "t.md" },
  ];
  const entries = buildHintEntries(commands);
  const names = entries.map((e) => e.name);
  expect(names).toContain("deploy");
});

// --- matchHintEntries ---

it("matchHintEntries returns all entries for empty partial", () => {
  const entries = buildHintEntries([]);
  const matches = matchHintEntries(entries, "");
  expect(matches.length).toBe(entries.length);
});

it("matchHintEntries filters by prefix", () => {
  const entries = buildHintEntries([]);
  const matches = matchHintEntries(entries, "he");
  expect(matches.length).toBe(1);
  expect(matches[0].name).toBe("help");
});

it("matchHintEntries is case-insensitive", () => {
  const entries = buildHintEntries([]);
  const matches = matchHintEntries(entries, "HE");
  expect(matches[0].name).toBe("help");
});

it("matchHintEntries returns empty for no match", () => {
  const entries = buildHintEntries([]);
  const matches = matchHintEntries(entries, "zzz");
  expect(matches).toHaveLength(0);
});

// --- formatHintLines ---

it("formatHintLines formats entries with aligned names", () => {
  const entries = [
    { name: "exit", description: "Exit the TUI" },
    { name: "commands", description: "List commands" },
  ];
  const lines = formatHintLines(entries);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("/exit");
  expect(lines[1]).toContain("/commands");
});

it("formatHintLines includes alias info", () => {
  const entries = [{ name: "exit", description: "Exit", aliases: "/quit, /q" }];
  const lines = formatHintLines(entries);
  expect(lines[0]).toContain("/quit");
});

it("formatHintLines caps at MAX_HINT_LINES", () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    name: `cmd${i}`,
    description: `Desc ${i}`,
  }));
  const lines = formatHintLines(entries);
  expect(lines.length).toBeLessThanOrEqual(8);
});
