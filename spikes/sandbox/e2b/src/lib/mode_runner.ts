import { runAll } from "./modes/all.js";
import { runI1 } from "./modes/i1.js";
import { runI2 } from "./modes/i2.js";
import { runI3 } from "./modes/i3.js";
import { runOrchestratorCrashChild } from "./modes/i3_orchestrator_crash.js";
import type { Mode, ResultByMode, ResultMode } from "./types.js";

const RESULT_MODE_RUNNERS: { [K in ResultMode]: () => Promise<ResultByMode[K]> } = {
  i1: () => runI1(),
  i2: () => runI2(10),
  i3: () => runI3(),
  all: () => runAll(),
};

function isMode(value: string): value is Mode {
  return (
    value === "i1" ||
    value === "i2" ||
    value === "i3" ||
    value === "all" ||
    value === "orchestrator-crash-child"
  );
}

export function parseMode(rawMode: string | undefined): Mode {
  const mode = rawMode ?? "all";
  if (isMode(mode)) {
    return mode;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

export function isResultMode(mode: Mode): mode is ResultMode {
  return mode !== "orchestrator-crash-child";
}

export async function runMode(mode: Mode): Promise<ResultByMode[ResultMode] | null> {
  if (!isResultMode(mode)) {
    await runOrchestratorCrashChild();
    return null;
  }

  return RESULT_MODE_RUNNERS[mode]();
}
