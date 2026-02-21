import { Sandbox } from "e2b";

import { findSandboxById } from "../sandbox_helpers.js";
import type { HangingCommandTestResult } from "../types.js";
import { nowIso, sleep } from "../utils/time.js";

export async function runHangingCommandTest(): Promise<HangingCommandTestResult> {
  const sandbox = await Sandbox.create({
    timeoutMs: 2 * 60_000,
    metadata: { spike: "i3", scenario: "hanging-command", startedAt: nowIso() },
  });

  const sandboxId = sandbox.sandboxId;

  try {
    const firstHandle = await sandbox.commands.run("sleep 9999", { background: true });
    await sleep(1_500);
    const killedByPid = await sandbox.commands.kill(firstHandle.pid);
    const processesAfterKill = await sandbox.commands.list();
    const pidStillPresentAfterKill = processesAfterKill.some((proc) => proc.pid === firstHandle.pid);

    const secondHandle = await sandbox.commands.run("sleep 9999", { background: true });
    const killSandboxFromOutside = await Sandbox.kill(sandboxId);
    await sleep(2_000);

    const sandboxExistsAfterOutsideKill = (await findSandboxById(sandboxId)) !== null;

    return {
      sandboxId,
      firstSleepPid: firstHandle.pid,
      killedByPid,
      pidStillPresentAfterKill,
      secondSleepPid: secondHandle.pid,
      killSandboxFromOutside,
      sandboxExistsAfterOutsideKill,
    };
  } finally {
    try {
      await Sandbox.kill(sandboxId);
    } catch {
      // Ignore; sandbox may already be terminated.
    }
  }
}
