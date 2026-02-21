import { performance } from "node:perf_hooks";

import type { StepTiming } from "../types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function toFixedMs(value: number): number {
  return Number(value.toFixed(2));
}

export async function timed<T>(
  step: string,
  timings: StepTiming[],
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const result = await operation();
  timings.push({ step, ms: toFixedMs(performance.now() - started) });
  return result;
}
