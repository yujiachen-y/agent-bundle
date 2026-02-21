import { spawn } from "node:child_process";
import process from "node:process";

import { Sandbox } from "e2b";

import { SPIKE_DIR } from "../paths.js";
import { findSandboxById } from "../sandbox_helpers.js";
import type { OrchestratorCrashTestResult } from "../types.js";
import { nowIso, sleep } from "../utils/time.js";

const CHILD_SANDBOX_ID_TIMEOUT_MS = 45_000;
const CHILD_EXIT_WAIT_TIMEOUT_MS = 10_000;
const SANDBOX_READY_DELAY_MS = 3_000;
const POST_KILL_SETTLE_DELAY_MS = 5_000;

type CrashChildProcess = ReturnType<typeof spawn>;

function spawnCrashChildProcess(): CrashChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "src/run_plan.ts", "orchestrator-crash-child"], {
    cwd: SPIKE_DIR,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function extractSandboxId(chunk: string): string | null {
  const match = chunk.match(/SANDBOX_ID=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function waitForChildSandboxId(child: CrashChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!child.stdout || !child.stderr) {
      reject(new Error("Child process stdio pipes are not available."));
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for child sandbox ID after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const sandboxId = extractSandboxId(chunk);
      if (!sandboxId) {
        return;
      }

      clearTimeout(timer);
      resolve(sandboxId);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      process.stderr.write(`[child-stderr] ${chunk}`);
    });
  });
}

function waitForChildExit(child: CrashChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve();
    }, timeoutMs);

    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function runOrchestratorCrashTest(): Promise<OrchestratorCrashTestResult> {
  const child = spawnCrashChildProcess();

  const sandboxId = await waitForChildSandboxId(child, CHILD_SANDBOX_ID_TIMEOUT_MS);
  await sleep(SANDBOX_READY_DELAY_MS);

  child.kill("SIGKILL");
  await waitForChildExit(child, CHILD_EXIT_WAIT_TIMEOUT_MS);
  await sleep(POST_KILL_SETTLE_DELAY_MS);

  const sandboxInfo = await findSandboxById(sandboxId);
  const sandboxStateAfterCrash = sandboxInfo?.state ?? "not_found";
  const sandboxSurvivedCrash = sandboxInfo !== null;

  if (sandboxSurvivedCrash) {
    await Sandbox.kill(sandboxId);
  }

  return {
    sandboxId,
    childExitCode: child.exitCode,
    childSignal: child.signalCode,
    sandboxStateAfterCrash,
    sandboxSurvivedCrash,
  };
}

export async function runOrchestratorCrashChild(): Promise<void> {
  const sandbox = await Sandbox.create({
    timeoutMs: 2 * 60_000,
    metadata: { spike: "i3", scenario: "orchestrator-crash-child", startedAt: nowIso() },
  });

  console.log(`SANDBOX_ID=${sandbox.sandboxId}`);
  await sandbox.commands.run("sleep 120", { background: true });

  await new Promise<void>(() => {
    // Keep the process alive until parent force-kills it.
  });
}
