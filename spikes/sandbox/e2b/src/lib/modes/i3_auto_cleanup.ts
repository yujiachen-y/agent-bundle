import { Sandbox } from "e2b";

import { findSandboxById } from "../sandbox_helpers.js";
import type { AutoCleanupTestResult, PollLogEntry } from "../types.js";
import { nowIso, sleep } from "../utils/time.js";

const AUTO_CLEANUP_TIMEOUT_MS = 45_000;
const AUTO_CLEANUP_POLL_INTERVAL_MS = 5_000;
const AUTO_CLEANUP_MAX_WAIT_MS = 120_000;

async function collectCleanupPollLog(
  sandboxId: string,
  pollIntervalMs: number,
  maxWaitMs: number,
): Promise<{ pollLog: PollLogEntry[]; cleanupObservedAtMs: number | null; finalState: string }> {
  const testStartedAt = Date.now();
  const pollLog: PollLogEntry[] = [];
  let cleanupObservedAtMs: number | null = null;
  let finalState = "unknown";

  while (Date.now() - testStartedAt <= maxWaitMs) {
    const info = await findSandboxById(sandboxId);
    const state = info?.state ?? "not_found";
    const elapsedMs = Date.now() - testStartedAt;
    pollLog.push({ elapsedMs, state });

    if (!info) {
      cleanupObservedAtMs = elapsedMs;
      finalState = "not_found";
      break;
    }

    finalState = info.state;
    await sleep(pollIntervalMs);
  }

  return { pollLog, cleanupObservedAtMs, finalState };
}

export async function runAutoCleanupTest(): Promise<AutoCleanupTestResult> {
  const sandbox = await Sandbox.create({
    timeoutMs: AUTO_CLEANUP_TIMEOUT_MS,
    metadata: { spike: "i3", scenario: "auto-cleanup", startedAt: nowIso() },
  });

  const sandboxId = sandbox.sandboxId;
  const pollState = await collectCleanupPollLog(
    sandboxId,
    AUTO_CLEANUP_POLL_INTERVAL_MS,
    AUTO_CLEANUP_MAX_WAIT_MS,
  );

  return {
    sandboxId,
    timeoutMs: AUTO_CLEANUP_TIMEOUT_MS,
    pollIntervalMs: AUTO_CLEANUP_POLL_INTERVAL_MS,
    maxWaitMs: AUTO_CLEANUP_MAX_WAIT_MS,
    cleanupObservedAtMs: pollState.cleanupObservedAtMs,
    finalState: pollState.finalState,
    pollLog: pollState.pollLog,
  };
}
