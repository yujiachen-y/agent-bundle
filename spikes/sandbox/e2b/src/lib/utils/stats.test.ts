import { describe, expect, it } from "vitest";

import { percentile, summarize } from "./stats.js";

describe("percentile", () => {
  it("returns 0 for empty input", () => {
    expect(percentile([], 90)).toBe(0);
  });

  it("returns the nearest-rank percentile", () => {
    const values = [5, 2, 9, 7, 1];

    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 90)).toBe(9);
    expect(percentile(values, 99)).toBe(9);
  });
});

describe("summarize", () => {
  it("returns zero stats for empty input", () => {
    expect(summarize([])).toEqual({
      p50: 0,
      p90: 0,
      p99: 0,
      min: 0,
      max: 0,
      avg: 0,
    });
  });

  it("computes rounded latency metrics", () => {
    const summary = summarize([10, 20, 30, 40]);

    expect(summary).toEqual({
      p50: 20,
      p90: 40,
      p99: 40,
      min: 10,
      max: 40,
      avg: 25,
    });
  });
});
