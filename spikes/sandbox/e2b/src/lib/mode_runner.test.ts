import { beforeEach, describe, expect, it, vi } from "vitest";

const runI1Mock = vi.fn();
const runI2Mock = vi.fn();
const runI3Mock = vi.fn();
const runAllMock = vi.fn();
const runOrchestratorCrashChildMock = vi.fn();

vi.mock("./modes/i1.js", () => ({
  runI1: runI1Mock,
}));

vi.mock("./modes/i2.js", () => ({
  runI2: runI2Mock,
}));

vi.mock("./modes/i3.js", () => ({
  runI3: runI3Mock,
}));

vi.mock("./modes/all.js", () => ({
  runAll: runAllMock,
}));

vi.mock("./modes/i3_orchestrator_crash.js", () => ({
  runOrchestratorCrashChild: runOrchestratorCrashChildMock,
}));

const modeRunner = await import("./mode_runner.js");

describe("parseMode", () => {
  it("defaults to all", () => {
    expect(modeRunner.parseMode(undefined)).toBe("all");
  });

  it("accepts known modes", () => {
    expect(modeRunner.parseMode("i1")).toBe("i1");
    expect(modeRunner.parseMode("i2")).toBe("i2");
    expect(modeRunner.parseMode("i3")).toBe("i3");
    expect(modeRunner.parseMode("all")).toBe("all");
    expect(modeRunner.parseMode("orchestrator-crash-child")).toBe("orchestrator-crash-child");
  });

  it("throws on unknown mode", () => {
    expect(() => modeRunner.parseMode("unknown")).toThrowError("Unknown mode: unknown");
  });
});

describe("isResultMode", () => {
  it("flags result and non-result modes", () => {
    expect(modeRunner.isResultMode("i1")).toBe(true);
    expect(modeRunner.isResultMode("i2")).toBe(true);
    expect(modeRunner.isResultMode("i3")).toBe(true);
    expect(modeRunner.isResultMode("all")).toBe(true);
    expect(modeRunner.isResultMode("orchestrator-crash-child")).toBe(false);
  });
});

describe("runMode", () => {
  beforeEach(() => {
    runI1Mock.mockReset();
    runI2Mock.mockReset();
    runI3Mock.mockReset();
    runAllMock.mockReset();
    runOrchestratorCrashChildMock.mockReset();
  });

  it("dispatches result modes", async () => {
    runI1Mock.mockResolvedValue({ mode: "i1" });
    runI2Mock.mockResolvedValue({ mode: "i2" });
    runI3Mock.mockResolvedValue({ mode: "i3" });
    runAllMock.mockResolvedValue({ mode: "all" });

    await expect(modeRunner.runMode("i1")).resolves.toEqual({ mode: "i1" });
    await expect(modeRunner.runMode("i2")).resolves.toEqual({ mode: "i2" });
    await expect(modeRunner.runMode("i3")).resolves.toEqual({ mode: "i3" });
    await expect(modeRunner.runMode("all")).resolves.toEqual({ mode: "all" });

    expect(runI1Mock).toHaveBeenCalledTimes(1);
    expect(runI2Mock).toHaveBeenCalledWith(10);
    expect(runI3Mock).toHaveBeenCalledTimes(1);
    expect(runAllMock).toHaveBeenCalledTimes(1);
  });

  it("runs child mode and returns null", async () => {
    runOrchestratorCrashChildMock.mockResolvedValue(undefined);

    await expect(modeRunner.runMode("orchestrator-crash-child")).resolves.toBeNull();
    expect(runOrchestratorCrashChildMock).toHaveBeenCalledTimes(1);
  });
});
