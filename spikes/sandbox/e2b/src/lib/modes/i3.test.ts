import { describe, expect, it, vi } from "vitest";

const runAutoCleanupTestMock = vi.fn();
const runOrchestratorCrashTestMock = vi.fn();
const runHangingCommandTestMock = vi.fn();

vi.mock("./i3_auto_cleanup.js", () => ({
  runAutoCleanupTest: runAutoCleanupTestMock,
}));

vi.mock("./i3_orchestrator_crash.js", () => ({
  runOrchestratorCrashTest: runOrchestratorCrashTestMock,
}));

vi.mock("./i3_hanging_command.js", () => ({
  runHangingCommandTest: runHangingCommandTestMock,
}));

const { runI3 } = await import("./i3.js");

describe("runI3", () => {
  it("aggregates sub-test results", async () => {
    runAutoCleanupTestMock.mockResolvedValue({ id: "auto" });
    runOrchestratorCrashTestMock.mockResolvedValue({ id: "crash" });
    runHangingCommandTestMock.mockResolvedValue({ id: "hang" });

    await expect(runI3()).resolves.toEqual({
      autoCleanup: { id: "auto" },
      orchestratorCrash: { id: "crash" },
      hangingCommand: { id: "hang" },
    });
  });
});
