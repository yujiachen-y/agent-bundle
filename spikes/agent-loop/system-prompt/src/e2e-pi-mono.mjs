import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { generateSystemPromptFromBundle, writePromptTemplate } from "./lib/system-prompt-builder.mjs";
import { applySessionContext } from "./runtime-prompt.mjs";

const LIST_SKILLS_PROMPT =
  "List the available skills and one-line descriptions from your instructions only. Do not call tools.";

/**
 * @param {string} stdout
 * @returns {Array<Record<string, unknown>>}
 */
function parseJsonEvents(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((event) => Boolean(event));
}

/**
 * @param {Array<Record<string, unknown>>} events
 * @returns {string}
 */
function extractAssistantText(events) {
  const assistantMessageEvent = [...events].reverse().find((event) => {
    return event.type === "message_end" && event.message && event.message.role === "assistant";
  });

  if (!assistantMessageEvent || !assistantMessageEvent.message || !Array.isArray(assistantMessageEvent.message.content)) {
    return "";
  }

  return assistantMessageEvent.message.content
    .filter((chunk) => chunk && typeof chunk === "object" && chunk.type === "text")
    .map((chunk) => chunk.text)
    .filter((text) => typeof text === "string")
    .join("");
}

/**
 * @param {{ cwd: string, provider: string, model: string, userPrompt: string, systemPromptPath?: string }} options
 * @returns {Promise<{ exitCode: number | null, stdout: string, stderr: string, events: Array<Record<string, unknown>>, assistantText: string }>}
 */
function runPiCommand(options) {
  const args = [
    "@mariozechner/pi-coding-agent",
    "--provider",
    options.provider,
    "--model",
    options.model,
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--tools",
    "read,bash,edit,write",
  ];

  if (options.systemPromptPath) {
    args.push("--system-prompt", options.systemPromptPath);
  }

  args.push(options.userPrompt);

  return new Promise((resolvePromise) => {
    const child = spawn("npx", args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (exitCode) => {
      const events = parseJsonEvents(stdout);
      resolvePromise({
        exitCode,
        stdout,
        stderr,
        events,
        assistantText: extractAssistantText(events),
      });
    });
  });
}

/**
 * @returns {{ provider: string, model: string } | null}
 */
function selectProviderAndModel() {
  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", model: "gpt-4o-mini" };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", model: "claude-3-5-sonnet-latest" };
  }

  return null;
}

/**
 * @returns {{ srcDir: string, spikeDir: string, resultsPath: string, promptPath: string, envPaths: string[] }}
 */
function resolveRuntimePaths() {
  const srcDir = dirname(new URL(import.meta.url).pathname);
  const spikeDir = resolve(srcDir, "..");
  return {
    srcDir,
    spikeDir,
    resultsPath: resolve(spikeDir, "results/e2e-smoke.json"),
    promptPath: resolve(spikeDir, "dist/system-prompt.e2e.txt"),
    envPaths: [resolve(spikeDir, ".env"), resolve(spikeDir, "../llm-provider/.env")],
  };
}

/**
 * @param {string[]} envPaths
 */
function loadEnvironmentFiles(envPaths) {
  envPaths.forEach((envPath) => {
    if (existsSync(envPath)) {
      loadEnv({ path: envPath, override: false });
    }
  });
}

/**
 * @param {string} resultsPath
 * @param {Record<string, unknown>} payload
 * @returns {Promise<void>}
 */
async function writeResultFile(resultsPath, payload) {
  await mkdir(dirname(resultsPath), { recursive: true });
  await writeFile(resultsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * @param {string} resultsPath
 * @returns {Promise<void>}
 */
async function writeSkippedResult(resultsPath) {
  const skipped = {
    status: "skipped",
    reason: "No supported API key found (OPENAI_API_KEY or ANTHROPIC_API_KEY).",
    checkedAt: new Date().toISOString(),
  };
  await writeResultFile(resultsPath, skipped);
  console.log(JSON.stringify(skipped, null, 2));
}

/**
 * @param {string} spikeDir
 * @param {string} promptPath
 * @returns {Promise<void>}
 */
async function preparePromptFile(spikeDir, promptPath) {
  const { prompt: templatePrompt } = await generateSystemPromptFromBundle(resolve(spikeDir, "bundle.sample.yaml"), {
    locationMode: "local",
  });
  const finalPrompt = applySessionContext(
    templatePrompt,
    "Session context: end-to-end verification with pre-generated prompt.",
  );
  await writePromptTemplate(promptPath, finalPrompt);
}

/**
 * @param {{ exitCode: number | null, stdout: string, stderr: string }} run
 * @param {string} label
 */
function assertRunSucceeded(run, label) {
  if (run.exitCode !== 0) {
    throw new Error(`${label}: ${run.stderr || run.stdout}`);
  }
}

/**
 * @param {string} spikeDir
 * @param {{ provider: string, model: string }} selected
 * @param {string} promptPath
 */
async function executeSmokeRuns(spikeDir, selected, promptPath) {
  const listSkillsRun = await runPiCommand({
    cwd: spikeDir,
    provider: selected.provider,
    model: selected.model,
    userPrompt: LIST_SKILLS_PROMPT,
    systemPromptPath: promptPath,
  });
  assertRunSucceeded(listSkillsRun, "Pre-generated prompt skill listing run failed");

  const readTarget = resolve(spikeDir, "sample-skills/data-validator/SKILL.md");
  const readSkillPrompt = `Use the read tool to read this SKILL.md and return only section headings:\n${readTarget}`;
  const readSkillRun = await runPiCommand({
    cwd: spikeDir,
    provider: selected.provider,
    model: selected.model,
    userPrompt: readSkillPrompt,
    systemPromptPath: promptPath,
  });
  assertRunSucceeded(readSkillRun, "Pre-generated prompt read-on-demand run failed");

  const baselineRun = await runPiCommand({
    cwd: spikeDir,
    provider: selected.provider,
    model: selected.model,
    userPrompt: LIST_SKILLS_PROMPT,
  });
  assertRunSucceeded(baselineRun, "Baseline dynamic run failed");

  return { listSkillsRun, readSkillRun, baselineRun };
}

/**
 * @param {{ provider: string, model: string }} selected
 * @param {number} startedAt
 * @param {{
 *  listSkillsRun: { events: Array<Record<string, unknown>>, assistantText: string };
 *  readSkillRun: { events: Array<Record<string, unknown>>, assistantText: string };
 *  baselineRun: { assistantText: string };
 * }} runData
 * @returns {Record<string, unknown>}
 */
function buildE2eResult(selected, startedAt, runData) {
  const listSkillToolCalls = runData.listSkillsRun.events.filter((event) => event.type === "tool_execution_start");
  const readSkillToolCalls = runData.readSkillRun.events.filter((event) => event.type === "tool_execution_start");
  const readToolCalls = readSkillToolCalls.filter((event) => event.toolName === "read");

  const listText = runData.listSkillsRun.assistantText;
  const readText = runData.readSkillRun.assistantText;
  const baselineText = runData.baselineRun.assistantText;
  const elapsedMs = performance.now() - startedAt;

  return {
    status: "ok",
    checkedAt: new Date().toISOString(),
    model: `${selected.provider}/${selected.model}`,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    checks: {
      knowsSkillsFromPrompt:
        listText.includes("pdf-extractor") && listText.includes("data-validator") && listText.includes("release-notes"),
      listSkillsWithoutFileRead: listSkillToolCalls.length === 0,
      readsSkillOnDemand: readToolCalls.length > 0 && readText.length > 0,
      dynamicPromptHasDifferentBehavior:
        !baselineText.includes("pdf-extractor") && !baselineText.includes("data-validator"),
    },
    runs: {
      listSkills: {
        toolCalls: listSkillToolCalls.length,
        assistantText: listText,
      },
      readSkill: {
        toolCalls: readSkillToolCalls.length,
        readToolCalls: readToolCalls.length,
        assistantText: readText,
      },
      baselineDynamic: {
        assistantText: baselineText,
      },
    },
  };
}

async function main() {
  const { spikeDir, resultsPath, promptPath, envPaths } = resolveRuntimePaths();
  loadEnvironmentFiles(envPaths);

  const selected = selectProviderAndModel();
  if (!selected) {
    await writeSkippedResult(resultsPath);
    return;
  }

  await preparePromptFile(spikeDir, promptPath);
  const startedAt = performance.now();
  const runData = await executeSmokeRuns(spikeDir, selected, promptPath);
  const result = buildE2eResult(selected, startedAt, runData);
  await writeResultFile(resultsPath, result);
  console.log(JSON.stringify(result, null, 2));
}

/**
 * @param {unknown} error
 * @returns {Promise<void>}
 */
async function handleMainError(error) {
  const { resultsPath } = resolveRuntimePaths();
  const failure = {
    status: "failed",
    checkedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
  await writeResultFile(resultsPath, failure);
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
}

main().catch(handleMainError);
