import type { LatencySummary } from "../types.js";
import { toFixedMs } from "./time.js";

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.min(position, sorted.length - 1)];
}

export function summarize(values: number[]): LatencySummary {
  if (values.length === 0) {
    return { p50: 0, p90: 0, p99: 0, min: 0, max: 0, avg: 0 };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    p50: toFixedMs(percentile(values, 50)),
    p90: toFixedMs(percentile(values, 90)),
    p99: toFixedMs(percentile(values, 99)),
    min: toFixedMs(Math.min(...values)),
    max: toFixedMs(Math.max(...values)),
    avg: toFixedMs(total / values.length),
  };
}
