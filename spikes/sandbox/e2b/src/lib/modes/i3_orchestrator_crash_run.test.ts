import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
const killSandboxMock = vi.fn();
const createSandboxMock = vi.fn();
const findSandboxByIdMock = vi.fn();
const sleepMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("e2b", () => ({
  Sandbox: {
    create: createSandboxMock,
    kill: killSandboxMock,
  },
}));

vi.mock("../sandbox_helpers.js", () => {
  return {
    findSandboxById: (...args: unknown[]) => findSandboxByIdMock(...args),
  };
});

vi.mock("../utils/time.js", () => ({
  nowIso: () => new Date("2026-02-21T00:00:00.000Z").toISOString(),
  sleep: (...args: unknown[]) => sleepMock(...args),
}));

const orchestratorCrashModule = await import("./i3_orchestrator_crash.js");

function makeMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: (encoding: string) => void };
    stderr: EventEmitter & { setEncoding: (encoding: string) => void };
    kill: (signal?: NodeJS.Signals) => boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  };

  const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  const stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };

  stdout.setEncoding = vi.fn();
  stderr.setEncoding = vi.fn();

  child.stdout = stdout;
  child.stderr = stderr;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn((signal?: NodeJS.Signals) => {
    child.signalCode = signal ?? null;
    setTimeout(() => {
      child.emit("exit", null, signal ?? null);
    }, 0);
    return true;
  });

  return child;
}

describe("orchestrator crash mode", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    killSandboxMock.mockReset();
    createSandboxMock.mockReset();
    findSandboxByIdMock.mockReset();
    sleepMock.mockReset();

    sleepMock.mockResolvedValue(undefined);
    killSandboxMock.mockResolvedValue(true);
  });

  it("kills surviving sandbox after child crash", async () => {
    const child = makeMockChild();
    spawnMock.mockReturnValue(child);
    findSandboxByIdMock.mockResolvedValue({ state: "running" });

    queueMicrotask(() => {
      child.stdout.emit("data", "SANDBOX_ID=sbx-crash");
    });

    const result = await orchestratorCrashModule.runOrchestratorCrashTest();

    expect(result.sandboxId).toBe("sbx-crash");
    expect(result.sandboxSurvivedCrash).toBe(true);
    expect(result.sandboxStateAfterCrash).toBe("running");
    expect(killSandboxMock).toHaveBeenCalledWith("sbx-crash");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does not call Sandbox.kill when sandbox already cleaned up", async () => {
    const child = makeMockChild();
    spawnMock.mockReturnValue(child);
    findSandboxByIdMock.mockResolvedValue(null);

    queueMicrotask(() => {
      child.stdout.emit("data", "SANDBOX_ID=sbx-cleaned");
    });

    const result = await orchestratorCrashModule.runOrchestratorCrashTest();

    expect(result.sandboxSurvivedCrash).toBe(false);
    expect(result.sandboxStateAfterCrash).toBe("not_found");
    expect(killSandboxMock).not.toHaveBeenCalled();
  });

  it("creates child sandbox and prints sandbox id", async () => {
    const commandsRunMock = vi.fn().mockResolvedValue({ pid: 12 });
    createSandboxMock.mockResolvedValue({
      sandboxId: "sbx-child",
      commands: { run: commandsRunMock },
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      return;
    });

    const runPromise = orchestratorCrashModule.runOrchestratorCrashChild();
    await Promise.resolve();

    expect(createSandboxMock).toHaveBeenCalledTimes(1);
    expect(commandsRunMock).toHaveBeenCalledWith("sleep 120", { background: true });
    expect(logSpy).toHaveBeenCalledWith("SANDBOX_ID=sbx-child");
    await expect(Promise.race([runPromise, Promise.resolve("pending")])).resolves.toBe("pending");

    logSpy.mockRestore();
  });
});
