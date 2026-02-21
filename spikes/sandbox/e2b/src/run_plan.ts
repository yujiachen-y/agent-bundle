import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { config as loadEnv } from "dotenv";
import { Sandbox, Template, type BuildInfo, type CommandResult, type SandboxInfo } from "e2b";

type StepTiming = {
  step: string;
  ms: number;
};

type I1Result = {
  sandboxId: string;
  timings: StepTiming[];
  command: CommandResult;
  outputText: string;
  workspaceEntries: string[];
};

type CycleMetric = {
  iteration: number;
  sandboxId: string;
  createMs: number;
  firstCommandMs: number;
  totalMs: number;
  cpuCount: number | null;
  memoryMB: number | null;
};

type LatencySummary = {
  p50: number;
  p90: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
};

type BenchmarkResult = {
  label: string;
  templateRef: string;
  cycles: CycleMetric[];
  createStats: LatencySummary;
  firstCommandStats: LatencySummary;
};

type I2Result = {
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

type AutoCleanupTestResult = {
  sandboxId: string;
  timeoutMs: number;
  pollIntervalMs: number;
  maxWaitMs: number;
  cleanupObservedAtMs: number | null;
  finalState: string;
  pollLog: Array<{ elapsedMs: number; state: string }>;
};

type OrchestratorCrashTestResult = {
  sandboxId: string;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  sandboxStateAfterCrash: string;
  sandboxSurvivedCrash: boolean;
};

type HangingCommandTestResult = {
  sandboxId: string;
  firstSleepPid: number;
  killedByPid: boolean;
  pidStillPresentAfterKill: boolean;
  secondSleepPid: number;
  killSandboxFromOutside: boolean;
  sandboxExistsAfterOutsideKill: boolean;
};

type I3Result = {
  autoCleanup: AutoCleanupTestResult;
  orchestratorCrash: OrchestratorCrashTestResult;
  hangingCommand: HangingCommandTestResult;
};

type AllResult = {
  i1: I1Result;
  i2: I2Result;
  i3: I3Result;
};

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC_DIR = path.dirname(THIS_FILE);
const SPIKE_DIR = path.resolve(SRC_DIR, "..");
const ENV_PATH = path.resolve(SPIKE_DIR, ".env");
const RESULTS_DIR = path.resolve(SPIKE_DIR, "results");
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toFixedMs(value: number): number {
  return Number(value.toFixed(2));
}

async function timed<T>(
  step: string,
  timings: StepTiming[],
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const result = await operation();
  timings.push({ step, ms: toFixedMs(performance.now() - started) });
  return result;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.min(position, sorted.length - 1)];
}

function summarize(values: number[]): LatencySummary {
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

async function safeKillSandbox(sandbox: Sandbox | null): Promise<void> {
  if (!sandbox) {
    return;
  }

  try {
    await sandbox.kill();
  } catch {
    // The sandbox may already be terminated; ignore cleanup failures.
  }
}

async function findSandboxById(sandboxId: string): Promise<SandboxInfo | null> {
  const paginator = Sandbox.list({ limit: 100 });

  while (paginator.hasNext) {
    const items = await paginator.nextItems();
    const match = items.find((item) => item.sandboxId === sandboxId);
    if (match) {
      return match;
    }
  }

  return null;
}

async function writeResultFile(mode: string, result: unknown): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true });

  const timestamp = nowIso().replace(/[:.]/g, "-");
  const outputPath = path.resolve(RESULTS_DIR, `${timestamp}-${mode}.json`);
  const latestPath = path.resolve(RESULTS_DIR, `latest-${mode}.json`);
  const payload = `${JSON.stringify(result, null, 2)}\n`;

  await writeFile(outputPath, payload, "utf8");
  await writeFile(latestPath, payload, "utf8");

  return outputPath;
}

async function runI1(): Promise<I1Result> {
  const timings: StepTiming[] = [];
  let sandbox: Sandbox | null = null;

  try {
    sandbox = await timed("create_sandbox", timings, () =>
      Sandbox.create({
        timeoutMs: DEFAULT_TIMEOUT_MS,
        metadata: { spike: "i1", startedAt: nowIso() },
      }),
    );
    const activeSandbox = sandbox;

    await timed("write_skill_file", timings, () =>
      activeSandbox.files.write(
        "/skills/hello/SKILL.md",
        "# Hello Skill\nThis is a dummy skill file for E2B spike.\n",
      ),
    );

    await timed("write_input_file", timings, () =>
      activeSandbox.files.write("/workspace/input.txt", "hello from agent-bundle\n"),
    );

    const command = await timed("run_command", timings, () =>
      activeSandbox.commands.run(
        'cat /skills/hello/SKILL.md && echo "processed" > /workspace/output.txt',
      ),
    );

    const outputText = await timed("read_output_file", timings, () =>
      activeSandbox.files.read("/workspace/output.txt"),
    );

    const workspaceListing = await timed("list_workspace", timings, () =>
      activeSandbox.files.list("/workspace"),
    );

    await timed("destroy_sandbox", timings, () => activeSandbox.kill());
    const sandboxId = activeSandbox.sandboxId;
    sandbox = null;

    return {
      sandboxId,
      timings,
      command,
      outputText,
      workspaceEntries: workspaceListing.map((entry) => entry.path),
    };
  } finally {
    await safeKillSandbox(sandbox);
  }
}

async function runBenchmarkCycle(
  iteration: number,
  templateRef: string | null,
): Promise<CycleMetric> {
  const cycleStarted = performance.now();
  let sandbox: Sandbox | null = null;

  try {
    const createStarted = performance.now();
    sandbox =
      templateRef === null
        ? await Sandbox.create({
            timeoutMs: 2 * 60_000,
            metadata: { spike: "i2", variant: "default", iteration: String(iteration) },
          })
        : await Sandbox.create(templateRef, {
            timeoutMs: 2 * 60_000,
            metadata: { spike: "i2", variant: "custom", iteration: String(iteration) },
          });
    const createMs = toFixedMs(performance.now() - createStarted);

    const sandboxInfo = await findSandboxById(sandbox.sandboxId);

    const firstCommandStarted = performance.now();
    await sandbox.commands.run("echo warmup");
    const firstCommandMs = toFixedMs(performance.now() - firstCommandStarted);

    return {
      iteration,
      sandboxId: sandbox.sandboxId,
      createMs,
      firstCommandMs,
      totalMs: toFixedMs(performance.now() - cycleStarted),
      cpuCount: sandboxInfo?.cpuCount ?? null,
      memoryMB: sandboxInfo?.memoryMB ?? null,
    };
  } finally {
    await safeKillSandbox(sandbox);
  }
}

async function runBenchmark(
  label: string,
  templateRef: string | null,
  iterations: number,
): Promise<BenchmarkResult> {
  const cycles: CycleMetric[] = [];

  for (let index = 0; index < iterations; index += 1) {
    const iteration = index + 1;
    const cycle = await runBenchmarkCycle(iteration, templateRef);
    cycles.push(cycle);
    console.log(
      `[i2][${label}] iteration=${iteration} create=${cycle.createMs}ms firstCommand=${cycle.firstCommandMs}ms`,
    );
  }

  return {
    label,
    templateRef: templateRef ?? "default",
    cycles,
    createStats: summarize(cycles.map((cycle) => cycle.createMs)),
    firstCommandStats: summarize(cycles.map((cycle) => cycle.firstCommandMs)),
  };
}

function buildTemplateName(): string {
  const timestamp = Date.now().toString();
  return `agent-bundle-spike-${timestamp}`;
}

async function buildCustomTemplate(): Promise<{
  templateRef: string;
  buildMs: number;
  buildInfo: BuildInfo;
}> {
  const templateName = buildTemplateName();
  const template = Template()
    .fromBaseImage()
    .runCmd(
      [
        "apt-get update",
        "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git curl jq",
        "mkdir -p /skills /workspace",
        "rm -rf /var/lib/apt/lists/*",
      ],
      { user: "root" },
    );

  const buildStarted = performance.now();
  const buildInfo = await Template.build(template, `${templateName}:latest`);
  const buildMs = toFixedMs(performance.now() - buildStarted);
  const firstTag = buildInfo.tags[0] ?? "latest";
  const templateRef = buildInfo.name.includes(":")
    ? buildInfo.name
    : `${buildInfo.name}:${firstTag}`;

  return {
    templateRef,
    buildMs,
    buildInfo,
  };
}

async function runI2(iterations = 10): Promise<I2Result> {
  const defaultTemplate = await runBenchmark("default", null, iterations);

  try {
    const build = await buildCustomTemplate();
    const benchmark = await runBenchmark("custom", build.templateRef, iterations);

    return {
      iterations,
      defaultTemplate,
      customTemplate: { build, benchmark },
      customTemplateError: null,
    };
  } catch (error) {
    return {
      iterations,
      defaultTemplate,
      customTemplate: null,
      customTemplateError: formatError(error),
    };
  }
}

async function runAutoCleanupTest(): Promise<AutoCleanupTestResult> {
  const timeoutMs = 45_000;
  const pollIntervalMs = 5_000;
  const maxWaitMs = 120_000;
  const sandbox = await Sandbox.create({
    timeoutMs,
    metadata: { spike: "i3", scenario: "auto-cleanup", startedAt: nowIso() },
  });

  const sandboxId = sandbox.sandboxId;
  const testStartedAt = Date.now();
  const pollLog: Array<{ elapsedMs: number; state: string }> = [];
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

  return {
    sandboxId,
    timeoutMs,
    pollIntervalMs,
    maxWaitMs,
    cleanupObservedAtMs,
    finalState,
    pollLog,
  };
}

function waitForChildSandboxId(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!child.stdout || !child.stderr) {
      reject(new Error("Child process stdio pipes are not available."));
      return;
    }

    const { stdout, stderr } = child;
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for child sandbox ID after ${timeoutMs}ms`));
    }, timeoutMs);

    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      const match = chunk.match(/SANDBOX_ID=([a-zA-Z0-9_-]+)/);
      if (!match) {
        return;
      }

      clearTimeout(timer);
      resolve(match[1]);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => {
      process.stderr.write(`[child-stderr] ${chunk}`);
    });
  });
}

function waitForChildExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<void> {
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

async function runOrchestratorCrashTest(): Promise<OrchestratorCrashTestResult> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/run_plan.ts", "orchestrator-crash-child"], {
    cwd: SPIKE_DIR,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const sandboxId = await waitForChildSandboxId(child, 45_000);
  await sleep(3_000);

  child.kill("SIGKILL");
  await waitForChildExit(child, 10_000);
  await sleep(5_000);

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

async function runHangingCommandTest(): Promise<HangingCommandTestResult> {
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

async function runI3(): Promise<I3Result> {
  const autoCleanup = await runAutoCleanupTest();
  const orchestratorCrash = await runOrchestratorCrashTest();
  const hangingCommand = await runHangingCommandTest();

  return {
    autoCleanup,
    orchestratorCrash,
    hangingCommand,
  };
}

async function runOrchestratorCrashChild(): Promise<void> {
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

function assertApiKey(): void {
  if (process.env.E2B_API_KEY) {
    return;
  }

  throw new Error(`Missing E2B_API_KEY. Expected in ${ENV_PATH}`);
}

async function runAll(): Promise<AllResult> {
  const i1 = await runI1();
  const i2 = await runI2(10);
  const i3 = await runI3();
  return { i1, i2, i3 };
}

async function main(): Promise<void> {
  loadEnv({ path: ENV_PATH });
  assertApiKey();

  const mode = process.argv[2] ?? "all";

  if (mode === "orchestrator-crash-child") {
    await runOrchestratorCrashChild();
    return;
  }

  if (mode === "i1") {
    const result = await runI1();
    const outputPath = await writeResultFile("i1", result);
    console.log(JSON.stringify({ outputPath, result }, null, 2));
    return;
  }

  if (mode === "i2") {
    const result = await runI2(10);
    const outputPath = await writeResultFile("i2", result);
    console.log(JSON.stringify({ outputPath, result }, null, 2));
    return;
  }

  if (mode === "i3") {
    const result = await runI3();
    const outputPath = await writeResultFile("i3", result);
    console.log(JSON.stringify({ outputPath, result }, null, 2));
    return;
  }

  if (mode === "all") {
    const result = await runAll();
    const outputPath = await writeResultFile("all", result);
    console.log(JSON.stringify({ outputPath, result }, null, 2));
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

main().catch((error: unknown) => {
  console.error(`[spike] failed: ${formatError(error)}`);
  process.exit(1);
});
