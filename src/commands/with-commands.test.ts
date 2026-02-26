import { describe, expect, it, vi } from "vitest";

import type { Agent } from "../agent/types.js";
import type { ResponseOutput } from "../agent-loop/types.js";
import { withCommands } from "./with-commands.js";

function createMockAgent(): Agent {
  const respondMock = vi.fn<Agent["respond"]>().mockResolvedValue({
    id: "resp-1",
    output: "mock response",
  });

  return {
    name: "test-agent",
    status: "ready",
    respond: respondMock,
    respondStream: vi.fn(),
    shutdown: vi.fn(),
  };
}

describe("withCommands substitution", () => {
  it("adds callable command methods to agent", async () => {
    const agent = createMockAgent();
    type Cmds = { quickAnalysis(args?: string): Promise<ResponseOutput> };
    const extended = withCommands<Cmds>(agent, [
      { methodName: "quickAnalysis", content: "Analyze $ARGUMENTS" },
    ]);

    expect(typeof extended.quickAnalysis).toBe("function");
    await extended.quickAnalysis("AAPL");
    expect(agent.respond).toHaveBeenCalledWith([{ role: "user", content: "Analyze AAPL" }]);
  });

  it("substitutes all $ARGUMENTS occurrences", async () => {
    const agent = createMockAgent();
    type Cmds = { compare(args?: string): Promise<ResponseOutput> };
    const extended = withCommands<Cmds>(agent, [
      { methodName: "compare", content: "Compare $ARGUMENTS with $ARGUMENTS again" },
    ]);
    await extended.compare("X");
    expect(agent.respond).toHaveBeenCalledWith([{ role: "user", content: "Compare X with X again" }]);
  });

  it("uses empty string when args omitted", async () => {
    const agent = createMockAgent();
    type Cmds = { reconcile(args?: string): Promise<ResponseOutput> };
    const extended = withCommands<Cmds>(agent, [
      { methodName: "reconcile", content: "Run reconciliation: $ARGUMENTS" },
    ]);
    await extended.reconcile();
    expect(agent.respond).toHaveBeenCalledWith([{ role: "user", content: "Run reconciliation: " }]);
  });

  it("handles special regex replacement patterns in args", async () => {
    const agent = createMockAgent();
    type Cmds = { run(args?: string): Promise<ResponseOutput> };
    const extended = withCommands<Cmds>(agent, [{ methodName: "run", content: "Run $ARGUMENTS" }]);
    await extended.run("$& $' $`");
    expect(agent.respond).toHaveBeenCalledWith([{ role: "user", content: "Run $& $' $`" }]);
  });

  it("returns the response from agent.respond", async () => {
    const agent = createMockAgent();
    type Cmds = { run(args?: string): Promise<ResponseOutput> };
    const extended = withCommands<Cmds>(agent, [{ methodName: "run", content: "Run $ARGUMENTS" }]);
    const result = await extended.run("test");
    expect(result).toEqual({ id: "resp-1", output: "mock response" });
  });
});

describe("withCommands edge cases", () => {
  it("preserves original agent properties via prototype chain", () => {
    const agent = createMockAgent();
    type Cmds = { doStuff(args?: string): Promise<ResponseOutput> };
    const extended = withCommands<Cmds>(agent, [{ methodName: "doStuff", content: "Do stuff" }]);
    expect(extended.name).toBe("test-agent");
    expect(extended.status).toBe("ready");
    expect(typeof extended.shutdown).toBe("function");
  });

  it("handles multiple commands", async () => {
    const agent = createMockAgent();
    type Cmds = { alpha(args?: string): Promise<ResponseOutput>; beta(args?: string): Promise<ResponseOutput> };
    const extended = withCommands<Cmds>(agent, [
      { methodName: "alpha", content: "Alpha $ARGUMENTS" },
      { methodName: "beta", content: "Beta $ARGUMENTS" },
    ]);
    await extended.alpha("A");
    await extended.beta("B");
    expect(agent.respond).toHaveBeenCalledTimes(2);
  });

  it("throws when command name conflicts with reserved property", () => {
    const agent = createMockAgent();
    const reserved = ["respond", "respondStream", "shutdown", "name", "status",
      "__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"];
    reserved.forEach((methodName) => {
      expect(() => withCommands(agent, [{ methodName, content: "test" }])).toThrowError(
        "conflicts with a reserved Agent property",
      );
    });
  });

  it("handles empty commands array", () => {
    const agent = createMockAgent();
    const extended = withCommands(agent, []);
    expect(extended.name).toBe("test-agent");
    expect(extended.status).toBe("ready");
  });
});
