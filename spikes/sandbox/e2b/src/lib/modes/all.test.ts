import { describe, expect, it, vi } from "vitest";

const runI1Mock = vi.fn();
const runI2Mock = vi.fn();
const runI3Mock = vi.fn();

vi.mock("./i1.js", () => ({
  runI1: runI1Mock,
}));

vi.mock("./i2.js", () => ({
  runI2: runI2Mock,
}));

vi.mock("./i3.js", () => ({
  runI3: runI3Mock,
}));

const { runAll } = await import("./all.js");

describe("runAll", () => {
  it("executes i1, i2, and i3 in order", async () => {
    runI1Mock.mockResolvedValue({ mode: "i1" });
    runI2Mock.mockResolvedValue({ mode: "i2" });
    runI3Mock.mockResolvedValue({ mode: "i3" });

    await expect(runAll()).resolves.toEqual({
      i1: { mode: "i1" },
      i2: { mode: "i2" },
      i3: { mode: "i3" },
    });

    expect(runI2Mock).toHaveBeenCalledWith(10);
  });
});
