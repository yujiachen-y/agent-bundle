import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { generateSystemPromptFromBundle, writePromptTemplate } from "./lib/system-prompt-builder.mjs";
import { applySessionContext } from "./runtime-prompt.mjs";

/**
 * @param {number[]} values
 * @param {number} percentile
 * @returns {number}
 */
function getPercentile(values, percentile) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value) {
  return Number(value.toFixed(6));
}

async function main() {
  const spikeDir = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const bundlePath = resolve(spikeDir, "bundle.sample.yaml");
  const promptPath = resolve(spikeDir, "dist/system-prompt.txt");
  const outputPath = resolve(spikeDir, "results/runtime-benchmark.json");

  const { prompt } = await generateSystemPromptFromBundle(bundlePath, {
    locationMode: "container",
  });
  await writePromptTemplate(promptPath, prompt);

  const iterations = 50000;
  const contexts = [
    "",
    "Session context: cwd=/workspace, locale=en-US, user_timezone=America/Los_Angeles",
    "Session context: cwd=/workspace/repo, git_branch=main, env=prod",
  ];

  Array.from({ length: 2000 }).forEach((_, index) => {
    const context = contexts[index % contexts.length];
    applySessionContext(prompt, context);
  });

  const durations = Array.from({ length: iterations }, (_, index) => {
    const context = contexts[index % contexts.length];
    const started = performance.now();
    applySessionContext(prompt, context);
    return performance.now() - started;
  });

  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  const result = {
    iterations,
    avgMs: round(totalMs / iterations),
    p50Ms: round(getPercentile(durations, 50)),
    p95Ms: round(getPercentile(durations, 95)),
    p99Ms: round(getPercentile(durations, 99)),
    maxMs: round(Math.max(...durations)),
    thresholdCheck: {
      lt10ms: (totalMs / iterations) < 10,
      lt1ms: (totalMs / iterations) < 1,
    },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
