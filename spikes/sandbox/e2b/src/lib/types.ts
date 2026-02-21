import type { BuildInfo, CommandResult } from "e2b";

export type StepTiming = {
  step: string;
  ms: number;
};

export type I1Result = {
  sandboxId: string;
  timings: StepTiming[];
  command: CommandResult;
  outputText: string;
  workspaceEntries: string[];
};

export type CycleMetric = {
  iteration: number;
  sandboxId: string;
  createMs: number;
  firstCommandMs: number;
  totalMs: number;
  cpuCount: number | null;
  memoryMB: number | null;
};

export type LatencySummary = {
  p50: number;
  p90: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
};

export type BenchmarkResult = {
  label: string;
  templateRef: string;
  cycles: CycleMetric[];
  createStats: LatencySummary;
  firstCommandStats: LatencySummary;
};

export type I2Result = {
  iterations: number;
  defaultTemplate: BenchmarkResult;
  customTemplate: {
    build: {
      templateRef: string;
      buildMs: number;
      buildInfo: BuildInfo;
    };
    benchmark: BenchmarkResult;
  } | null;
  customTemplateError: string | null;
};

export type PollLogEntry = {
  elapsedMs: number;
  state: string;
};

export type AutoCleanupTestResult = {
  sandboxId: string;
  timeoutMs: number;
  pollIntervalMs: number;
  maxWaitMs: number;
  cleanupObservedAtMs: number | null;
  finalState: string;
  pollLog: PollLogEntry[];
};

export type OrchestratorCrashTestResult = {
  sandboxId: string;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  sandboxStateAfterCrash: string;
  sandboxSurvivedCrash: boolean;
};

export type HangingCommandTestResult = {
  sandboxId: string;
  firstSleepPid: number;
  killedByPid: boolean;
  pidStillPresentAfterKill: boolean;
  secondSleepPid: number;
  killSandboxFromOutside: boolean;
  sandboxExistsAfterOutsideKill: boolean;
};

export type I3Result = {
  autoCleanup: AutoCleanupTestResult;
  orchestratorCrash: OrchestratorCrashTestResult;
  hangingCommand: HangingCommandTestResult;
};

export type AllResult = {
  i1: I1Result;
  i2: I2Result;
  i3: I3Result;
};

export type ResultMode = "i1" | "i2" | "i3" | "all";

export type Mode = ResultMode | "orchestrator-crash-child";

export type ResultByMode = {
  i1: I1Result;
  i2: I2Result;
  i3: I3Result;
  all: AllResult;
};
