import { expect, it, vi } from "vitest";

import type { AgentStatus } from "../agent/types.js";
import type { Command } from "../commands/types.js";

import {
  createSlashCompleter,
  findBuiltinCommand,
  getBuiltinCommands,
  type BuiltinContext,
} from "./builtin-commands.js";

function createTestContext(overrides: Partial<BuiltinContext> = {}): BuiltinContext & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write: (text: string) => written.push(text),
    close: vi.fn(),
    clearScreen: vi.fn(),
    agent: {
      name: "test-agent",
      get status(): AgentStatus {
        return "ready";
      },
      respond: vi.fn(),
      respondStream: vi.fn(),
      shutdown: vi.fn(),
    },
    commands: [],
    ...overrides,
  };
}

// --- findBuiltinCommand ---

it("findBuiltinCommand returns handler for exit", () => {
  expect(findBuiltinCommand("exit")).toBeDefined();
});

it("findBuiltinCommand returns handler for quit alias", () => {
  expect(findBuiltinCommand("quit")).toBeDefined();
});

it("findBuiltinCommand returns handler for q alias", () => {
  expect(findBuiltinCommand("q")).toBeDefined();
});

it("findBuiltinCommand returns handler for ? alias of help", () => {
  expect(findBuiltinCommand("?")).toBeDefined();
});

it("findBuiltinCommand returns handler for cls alias of clear", () => {
  expect(findBuiltinCommand("cls")).toBeDefined();
});

it("findBuiltinCommand is case-insensitive", () => {
  expect(findBuiltinCommand("EXIT")).toBeDefined();
  expect(findBuiltinCommand("Help")).toBeDefined();
  expect(findBuiltinCommand("CLEAR")).toBeDefined();
});

it("findBuiltinCommand returns undefined for unknown command", () => {
  expect(findBuiltinCommand("unknown")).toBeUndefined();
});

// --- getBuiltinCommands ---

it("getBuiltinCommands returns all builtin commands", () => {
  const builtins = getBuiltinCommands();
  expect(builtins.has("exit")).toBe(true);
  expect(builtins.has("clear")).toBe(true);
  expect(builtins.has("help")).toBe(true);
  expect(builtins.has("commands")).toBe(true);
  expect(builtins.has("status")).toBe(true);
});

// --- /exit handler ---

it("exit handler calls close", () => {
  const ctx = createTestContext();
  findBuiltinCommand("exit")!.handler(ctx, "");
  expect(ctx.close).toHaveBeenCalled();
});

it("quit alias calls close", () => {
  const ctx = createTestContext();
  findBuiltinCommand("quit")!.handler(ctx, "");
  expect(ctx.close).toHaveBeenCalled();
});

// --- /clear handler ---

it("clear handler calls clearScreen", () => {
  const ctx = createTestContext();
  findBuiltinCommand("clear")!.handler(ctx, "");
  expect(ctx.clearScreen).toHaveBeenCalled();
});

// --- /help handler ---

it("help handler lists builtin commands", () => {
  const ctx = createTestContext();
  findBuiltinCommand("help")!.handler(ctx, "");
  const output = ctx.written.join("");
  expect(output).toContain("/exit");
  expect(output).toContain("/clear");
  expect(output).toContain("/help");
  expect(output).toContain("/commands");
  expect(output).toContain("/status");
});

it("help handler lists user-defined commands", () => {
  const commands: Command[] = [
    { name: "analyze", description: "Run analysis", content: "...", sourcePath: "test.md" },
  ];
  const ctx = createTestContext({ commands });
  findBuiltinCommand("help")!.handler(ctx, "");
  const output = ctx.written.join("");
  expect(output).toContain("/analyze");
  expect(output).toContain("Run analysis");
});

it("help handler shows argument hints for user commands", () => {
  const commands: Command[] = [
    {
      name: "analyze",
      description: "Run analysis",
      argumentHint: "<ticker>",
      content: "...",
      sourcePath: "test.md",
    },
  ];
  const ctx = createTestContext({ commands });
  findBuiltinCommand("help")!.handler(ctx, "");
  const output = ctx.written.join("");
  expect(output).toContain("<ticker>");
});

it("help handler omits user section when no user commands", () => {
  const ctx = createTestContext({ commands: [] });
  findBuiltinCommand("help")!.handler(ctx, "");
  const output = ctx.written.join("");
  expect(output).toContain("Built-in commands");
  expect(output).not.toContain("Agent commands");
});

// --- /commands handler ---

it("commands handler shows empty message when no user commands", () => {
  const ctx = createTestContext({ commands: [] });
  findBuiltinCommand("commands")!.handler(ctx, "");
  const output = ctx.written.join("");
  expect(output).toContain("No agent commands");
});

it("commands handler lists user commands", () => {
  const commands: Command[] = [
    { name: "deploy", description: "Deploy the app", content: "...", sourcePath: "test.md" },
    { name: "test", description: "Run tests", content: "...", sourcePath: "test.md" },
  ];
  const ctx = createTestContext({ commands });
  findBuiltinCommand("commands")!.handler(ctx, "");
  const output = ctx.written.join("");
  expect(output).toContain("/deploy");
  expect(output).toContain("/test");
});

// --- /status handler ---

it("status handler shows agent name and status", () => {
  const ctx = createTestContext();
  findBuiltinCommand("status")!.handler(ctx, "");
  const output = ctx.written.join("");
  expect(output).toContain("test-agent");
  expect(output).toContain("ready");
});

it("status handler shows running status", () => {
  const ctx = createTestContext({
    agent: {
      name: "busy-agent",
      get status(): AgentStatus {
        return "running";
      },
      respond: vi.fn(),
      respondStream: vi.fn(),
      shutdown: vi.fn(),
    },
  });
  findBuiltinCommand("status")!.handler(ctx, "");
  const output = ctx.written.join("");
  expect(output).toContain("busy-agent");
  expect(output).toContain("running");
});

// --- createSlashCompleter ---

it("completer returns all commands for bare /", () => {
  const completer = createSlashCompleter([]);
  const [hits] = completer("/");
  expect(hits).toContain("/exit");
  expect(hits).toContain("/help");
  expect(hits).toContain("/clear");
  expect(hits).toContain("/status");
});

it("completer filters by partial input", () => {
  const completer = createSlashCompleter([]);
  const [hits] = completer("/he");
  expect(hits).toContain("/help");
  expect(hits).not.toContain("/exit");
});

it("completer auto-completes single match", () => {
  const completer = createSlashCompleter([]);
  const [hits] = completer("/sta");
  expect(hits).toEqual(["/status"]);
});

it("completer includes user-defined commands", () => {
  const commands: Command[] = [
    { name: "analyze", description: "Run analysis", content: "...", sourcePath: "test.md" },
  ];
  const completer = createSlashCompleter(commands);
  const [hits] = completer("/an");
  expect(hits).toContain("/analyze");
});

it("completer includes aliases", () => {
  const completer = createSlashCompleter([]);
  const [hits] = completer("/qu");
  expect(hits).toContain("/quit");
});

it("completer returns empty for non-slash input", () => {
  const completer = createSlashCompleter([]);
  const [hits] = completer("hello");
  expect(hits).toHaveLength(0);
});
