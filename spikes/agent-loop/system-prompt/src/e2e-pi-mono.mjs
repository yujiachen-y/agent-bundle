import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { generateSystemPromptFromBundle, writePromptTemplate } from "./lib/system-prompt-builder.mjs";
import { applySessionContext } from "./runtime-prompt.mjs";

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

async function main() {
  const srcDir = dirname(new URL(import.meta.url).pathname);
  const spikeDir = resolve(srcDir, "..");
  const resultsPath = resolve(spikeDir, "results/e2e-smoke.json");
  const promptPath = resolve(spikeDir, "dist/system-prompt.e2e.txt");

  [resolve(spikeDir, ".env"), resolve(spikeDir, "../llm-provider/.env")].forEach((envPath) => {
    if (existsSync(envPath)) {
      loadEnv({ path: envPath, override: false });
    }
  });

  const selected = selectProviderAndModel();
  if (!selected) {
    const skipped = {
      status: "skipped",
      reason: "No supported API key found (OPENAI_API_KEY or ANTHROPIC_API_KEY).",
      checkedAt: new Date().toISOString(),
    };
    await mkdir(dirname(resultsPath), { recursive: true });
    await writeFile(resultsPath, `${JSON.stringify(skipped, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(skipped, null, 2));
    return;
  }

  const { prompt: templatePrompt } = await generateSystemPromptFromBundle(resolve(spikeDir, "bundle.sample.yaml"), {
    locationMode: "local",
  });
  const finalPrompt = applySessionContext(
    templatePrompt,
    "Session context: end-to-end verification with pre-generated prompt.",
  );
  await writePromptTemplate(promptPath, finalPrompt);

  const started = performance.now();

  const listSkillsPrompt =
    "List the available skills and one-line descriptions from your instructions only. Do not call tools.";
  const listSkillsRun = await runPiCommand({
    cwd: spikeDir,
    provider: selected.provider,
    model: selected.model,
    userPrompt: listSkillsPrompt,
    systemPromptPath: promptPath,
  });

  if (listSkillsRun.exitCode !== 0) {
    throw new Error(`Pre-generated prompt skill listing run failed: ${listSkillsRun.stderr || listSkillsRun.stdout}`);
  }

  const readTarget = resolve(spikeDir, "sample-skills/data-validator/SKILL.md");
  const readSkillPrompt = `Use the read tool to read this SKILL.md and return only section headings:\n${readTarget}`;
  const readSkillRun = await runPiCommand({
    cwd: spikeDir,
    provider: selected.provider,
    model: selected.model,
    userPrompt: readSkillPrompt,
    systemPromptPath: promptPath,
  });

  if (readSkillRun.exitCode !== 0) {
    throw new Error(`Pre-generated prompt read-on-demand run failed: ${readSkillRun.stderr || readSkillRun.stdout}`);
  }

  const baselineRun = await runPiCommand({
    cwd: spikeDir,
    provider: selected.provider,
    model: selected.model,
    userPrompt: listSkillsPrompt,
  });

  if (baselineRun.exitCode !== 0) {
    throw new Error(`Baseline dynamic run failed: ${baselineRun.stderr || baselineRun.stdout}`);
  }

  const listSkillToolCalls = listSkillsRun.events.filter((event) => event.type === "tool_execution_start");
  const readSkillToolCalls = readSkillRun.events.filter((event) => event.type === "tool_execution_start");
  const readToolCalls = readSkillToolCalls.filter((event) => event.toolName === "read");

  const listText = listSkillsRun.assistantText;
  const readText = readSkillRun.assistantText;
  const baselineText = baselineRun.assistantText;

  const elapsedMs = performance.now() - started;
  const result = {
    status: "ok",
    checkedAt: new Date().toISOString(),
    model: `${selected.provider}/${selected.model}`,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    checks: {
      knowsSkillsFromPrompt:
        listText.includes("pdf-extractor") &&
        listText.includes("data-validator") &&
        listText.includes("release-notes"),
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

  await mkdir(dirname(resultsPath), { recursive: true });
  await writeFile(resultsPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(async (error) => {
  const srcDir = dirname(new URL(import.meta.url).pathname);
  const spikeDir = resolve(srcDir, "..");
  const resultsPath = resolve(spikeDir, "results/e2e-smoke.json");
  const failure = {
    status: "failed",
    checkedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
  await mkdir(dirname(resultsPath), { recursive: true });
  await writeFile(resultsPath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
});
