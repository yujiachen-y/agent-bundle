import type { I3Result } from "../types.js";
import { runAutoCleanupTest } from "./i3_auto_cleanup.js";
import { runHangingCommandTest } from "./i3_hanging_command.js";
import { runOrchestratorCrashTest } from "./i3_orchestrator_crash.js";

export async function runI3(): Promise<I3Result> {
  const autoCleanup = await runAutoCleanupTest();
  const orchestratorCrash = await runOrchestratorCrashTest();
  const hangingCommand = await runHangingCommandTest();

  return {
    autoCleanup,
    orchestratorCrash,
    hangingCommand,
  };
}
