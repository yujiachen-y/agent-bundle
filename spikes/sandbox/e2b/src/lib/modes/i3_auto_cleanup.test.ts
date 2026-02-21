import { beforeEach, describe, expect, it, vi } from "vitest";

const createSandboxMock = vi.fn();
const findSandboxByIdMock = vi.fn();
const sleepMock = vi.fn();

vi.mock("e2b", () => ({
  Sandbox: {
    create: createSandboxMock,
  },
}));

vi.mock("../sandbox_helpers.js", () => ({
  findSandboxById: findSandboxByIdMock,
}));

vi.mock("../utils/time.js", () => ({
  nowIso: () => "2026-02-21T00:00:00.000Z",
  sleep: sleepMock,
}));

const { runAutoCleanupTest } = await import("./i3_auto_cleanup.js");

describe("runAutoCleanupTest", () => {
  beforeEach(() => {
    createSandboxMock.mockReset();
    findSandboxByIdMock.mockReset();
    sleepMock.mockReset();

    createSandboxMock.mockResolvedValue({ sandboxId: "sbx-cleanup" });
    findSandboxByIdMock.mockResolvedValue(null);
    sleepMock.mockResolvedValue(undefined);
  });

  it("reports cleanup once sandbox is no longer listed", async () => {
    const result = await runAutoCleanupTest();

    expect(result.sandboxId).toBe("sbx-cleanup");
    expect(result.cleanupObservedAtMs).not.toBeNull();
    expect(result.finalState).toBe("not_found");
    expect(result.pollLog).toHaveLength(1);
    expect(result.pollLog[0].state).toBe("not_found");
    expect(sleepMock).not.toHaveBeenCalled();
  });
});
