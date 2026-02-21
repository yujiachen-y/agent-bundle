import { performance } from "node:perf_hooks";

import { Sandbox, Template, type BuildInfo } from "e2b";

import { BENCHMARK_TIMEOUT_MS } from "../constants.js";
import { findSandboxById, safeKillSandbox } from "../sandbox_helpers.js";
import type { BenchmarkResult, CycleMetric, I2Result } from "../types.js";
import { formatError } from "../utils/errors.js";
import { summarize } from "../utils/stats.js";
import { toFixedMs } from "../utils/time.js";

function buildBenchmarkMetadata(iteration: number, templateRef: string | null): Record<string, string> {
  return {
    spike: "i2",
    variant: templateRef === null ? "default" : "custom",
    iteration: String(iteration),
  };
}

async function createBenchmarkSandbox(iteration: number, templateRef: string | null): Promise<Sandbox> {
  const metadata = buildBenchmarkMetadata(iteration, templateRef);
  if (templateRef === null) {
    return Sandbox.create({ timeoutMs: BENCHMARK_TIMEOUT_MS, metadata });
  }

  return Sandbox.create(templateRef, { timeoutMs: BENCHMARK_TIMEOUT_MS, metadata });
}

async function runBenchmarkCycle(iteration: number, templateRef: string | null): Promise<CycleMetric> {
  const cycleStarted = performance.now();
  let sandbox: Sandbox | null = null;

  try {
    const createStarted = performance.now();
    sandbox = await createBenchmarkSandbox(iteration, templateRef);
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

export function buildTemplateName(epochMs = Date.now()): string {
  return `agent-bundle-spike-${String(epochMs)}`;
}

export function resolveTemplateRef(buildInfo: BuildInfo): string {
  const firstTag = buildInfo.tags[0] ?? "latest";
  return buildInfo.name.includes(":") ? buildInfo.name : `${buildInfo.name}:${firstTag}`;
}

async function buildCustomTemplate(): Promise<{ templateRef: string; buildMs: number; buildInfo: BuildInfo }> {
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

  return {
    templateRef: resolveTemplateRef(buildInfo),
    buildMs: toFixedMs(performance.now() - buildStarted),
    buildInfo,
  };
}

export async function runI2(iterations = 10): Promise<I2Result> {
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
