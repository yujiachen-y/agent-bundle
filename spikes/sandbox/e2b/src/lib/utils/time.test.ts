import { describe, expect, it } from "vitest";

import { nowIso, sleep, timed, toFixedMs } from "./time.js";

describe("toFixedMs", () => {
  it("rounds to two decimals", () => {
    expect(toFixedMs(1.2345)).toBe(1.23);
    expect(toFixedMs(1.235)).toBe(1.24);
  });
});

describe("timed", () => {
  it("records timing and returns result", async () => {
    const timings: Array<{ step: string; ms: number }> = [];
    const result = await timed("sample", timings, async () => {
      await sleep(0);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(timings).toHaveLength(1);
    expect(timings[0].step).toBe("sample");
    expect(timings[0].ms).toBeGreaterThanOrEqual(0);
  });
});

describe("nowIso", () => {
  it("returns an ISO timestamp", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
