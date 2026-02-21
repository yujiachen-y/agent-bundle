import { beforeEach, describe, expect, it, vi } from "vitest";

const createSandboxMock = vi.fn();
const killSandboxMock = vi.fn();
const findSandboxByIdMock = vi.fn();
const sleepMock = vi.fn();

vi.mock("e2b", () => ({
  Sandbox: {
    create: createSandboxMock,
    kill: killSandboxMock,
  },
}));

vi.mock("../sandbox_helpers.js", () => ({
  findSandboxById: findSandboxByIdMock,
}));

vi.mock("../utils/time.js", () => ({
  nowIso: () => "2026-02-21T00:00:00.000Z",
  sleep: sleepMock,
}));

const { runHangingCommandTest } = await import("./i3_hanging_command.js");

function makeSandbox() {
  return {
    sandboxId: "sbx-hanging",
    commands: {
      run: vi
        .fn()
        .mockResolvedValueOnce({ pid: 1001 })
        .mockResolvedValueOnce({ pid: 1002 }),
      kill: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("runHangingCommandTest", () => {
  beforeEach(() => {
    createSandboxMock.mockReset();
    killSandboxMock.mockReset();
    findSandboxByIdMock.mockReset();
    sleepMock.mockReset();

    createSandboxMock.mockResolvedValue(makeSandbox());
    killSandboxMock.mockResolvedValue(true);
    findSandboxByIdMock.mockResolvedValue(null);
    sleepMock.mockResolvedValue(undefined);
  });

  it("verifies command kill and outside sandbox kill behavior", async () => {
    const result = await runHangingCommandTest();

    expect(result).toEqual({
      sandboxId: "sbx-hanging",
      firstSleepPid: 1001,
      killedByPid: true,
      pidStillPresentAfterKill: false,
      secondSleepPid: 1002,
      killSandboxFromOutside: true,
      sandboxExistsAfterOutsideKill: false,
    });

    expect(killSandboxMock).toHaveBeenCalledWith("sbx-hanging");
    expect(killSandboxMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });
});
