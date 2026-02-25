import { describe, expect, it, vi } from "vitest";

import type { ResponseOutput } from "../agent-loop/types.js";
import type { Agent } from "../agent/types.js";
import type { Command } from "../commands/types.js";
import { createServer } from "./create-server.js";
import { substituteArguments } from "./command-routes.js";

function createAgentMock(): {
  agent: Agent;
  respond: ReturnType<typeof vi.fn<Agent["respond"]>>;
} {
  const respond = vi.fn<Agent["respond"]>();
  const respondStream = vi.fn<Agent["respondStream"]>();

  return {
    agent: {
      name: "test-agent",
      status: "ready",
      respond,
      respondStream,
      shutdown: vi.fn<Agent["shutdown"]>().mockResolvedValue(undefined),
    },
    respond,
  };
}

function createTestCommand(overrides: Partial<Command> = {}): Command {
  return {
    name: "quick-analysis",
    description: "Perform a quick financial analysis",
    argumentHint: "<description>",
    content: "Analyze the following: $ARGUMENTS",
    sourcePath: "/commands/quick-analysis.md",
    ...overrides,
  };
}

describe("substituteArguments", () => {
  it("replaces $ARGUMENTS with the provided args string", () => {
    const result = substituteArguments("Run analysis on $ARGUMENTS now", "Q4 data");
    expect(result).toBe("Run analysis on Q4 data now");
  });

  it("replaces multiple occurrences of $ARGUMENTS", () => {
    const result = substituteArguments("First: $ARGUMENTS, Second: $ARGUMENTS", "test");
    expect(result).toBe("First: test, Second: test");
  });

  it("returns content unchanged when no $ARGUMENTS placeholder exists", () => {
    const result = substituteArguments("No placeholders here", "args");
    expect(result).toBe("No placeholders here");
  });

  it("handles empty args string", () => {
    const result = substituteArguments("Analyze $ARGUMENTS", "");
    expect(result).toBe("Analyze ");
  });
});

describe("GET /commands", () => {
  it("returns the command list with name, description, and argumentHint", async () => {
    const { agent } = createAgentMock();
    const commands = [
      createTestCommand(),
      createTestCommand({ name: "reconciliation", description: "Reconcile data", argumentHint: undefined }),
    ];
    const app = createServer(agent, { commands });

    const response = await app.request("/commands");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([
      { name: "quick-analysis", description: "Perform a quick financial analysis", argumentHint: "<description>" },
      { name: "reconciliation", description: "Reconcile data" },
    ]);
  });

  it("returns 404 when no commands option is provided", async () => {
    const { agent } = createAgentMock();
    const app = createServer(agent);

    const response = await app.request("/commands");

    expect(response.status).toBe(404);
  });

  it("returns 404 when commands array is empty", async () => {
    const { agent } = createAgentMock();
    const app = createServer(agent, { commands: [] });

    const response = await app.request("/commands");

    expect(response.status).toBe(404);
  });
});

describe("POST /commands/:name", () => {
  it("triggers a command and returns agent response", async () => {
    const { agent, respond } = createAgentMock();
    const output: ResponseOutput = { id: "r1", output: "Analysis complete" };
    respond.mockResolvedValue(output);

    const commands = [createTestCommand()];
    const app = createServer(agent, { commands });

    const response = await app.request("/commands/quick-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: "Q4 revenue data" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(output);
    expect(respond).toHaveBeenCalledWith([
      { role: "user", content: "Analyze the following: Q4 revenue data" },
    ]);
  });

  it("returns 404 for unknown command", async () => {
    const { agent } = createAgentMock();
    const commands = [createTestCommand()];
    const app = createServer(agent, { commands });

    const response = await app.request("/commands/nonexistent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: "test" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.message).toContain("nonexistent");
  });

  it("uses empty string when no args provided", async () => {
    const { agent, respond } = createAgentMock();
    const output: ResponseOutput = { id: "r1", output: "ok" };
    respond.mockResolvedValue(output);

    const commands = [createTestCommand()];
    const app = createServer(agent, { commands });

    const response = await app.request("/commands/quick-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    expect(respond).toHaveBeenCalledWith([
      { role: "user", content: "Analyze the following: " },
    ]);
  });

  it("handles missing request body gracefully", async () => {
    const { agent, respond } = createAgentMock();
    const output: ResponseOutput = { id: "r1", output: "ok" };
    respond.mockResolvedValue(output);

    const commands = [createTestCommand()];
    const app = createServer(agent, { commands });

    const response = await app.request("/commands/quick-analysis", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(respond).toHaveBeenCalledWith([
      { role: "user", content: "Analyze the following: " },
    ]);
  });

  it("returns 500 when agent respond throws", async () => {
    const { agent, respond } = createAgentMock();
    respond.mockRejectedValue(new Error("agent crashed"));

    const commands = [createTestCommand()];
    const app = createServer(agent, { commands });

    const response = await app.request("/commands/quick-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: "test" }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.message).toBe("agent crashed");
  });

  it("performs case-insensitive command name lookup", async () => {
    const { agent, respond } = createAgentMock();
    const output: ResponseOutput = { id: "r1", output: "ok" };
    respond.mockResolvedValue(output);

    const commands = [createTestCommand({ name: "Quick-Analysis" })];
    const app = createServer(agent, { commands });

    const response = await app.request("/commands/quick-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: "data" }),
    });

    expect(response.status).toBe(200);
  });
});
