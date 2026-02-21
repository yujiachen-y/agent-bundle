import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { encodingForModel, getEncoding } from "js-tiktoken";
import {
  buildSystemPromptTemplate,
  generateSystemPromptFromBundle,
  loadSkillsFromBundle,
  writePromptTemplate,
} from "./lib/system-prompt-builder.mjs";

function round(value) {
  return Number(value.toFixed(2));
}

/**
 * @param {string} text
 * @param {import("js-tiktoken").Tiktoken} encoder
 * @returns {number}
 */
function countTokens(text, encoder) {
  return encoder.encode(text).length;
}

async function main() {
  const spikeDir = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const distDir = resolve(spikeDir, "dist");
  const resultPath = resolve(spikeDir, "results/token-analysis.json");

  const bundleMixedPath = resolve(spikeDir, "bundle.sample.yaml");
  const bundleDescPath = resolve(spikeDir, "bundle.description-only.yaml");
  const bundleFullPath = resolve(spikeDir, "bundle.full.yaml");

  const mixed = await generateSystemPromptFromBundle(bundleMixedPath, { locationMode: "container" });
  const desc = await generateSystemPromptFromBundle(bundleDescPath, { locationMode: "container" });
  const full = await generateSystemPromptFromBundle(bundleFullPath, { locationMode: "container" });

  await writePromptTemplate(resolve(distDir, "system-prompt.txt"), mixed.prompt);
  await writePromptTemplate(resolve(distDir, "system-prompt.description-only.txt"), desc.prompt);
  await writePromptTemplate(resolve(distDir, "system-prompt.full.txt"), full.prompt);

  const mixedSkills = await loadSkillsFromBundle(bundleMixedPath);
  const basePrompt = buildSystemPromptTemplate({ skills: [], locationMode: "container" });

  const encoder =
    (() => {
      try {
        return encodingForModel("gpt-4o");
      } catch {
        return getEncoding("cl100k_base");
      }
    })();

  const baseTokens = countTokens(basePrompt, encoder);
  const mixedTokens = countTokens(mixed.prompt, encoder);
  const descriptionOnlyTokens = countTokens(desc.prompt, encoder);
  const fullTokens = countTokens(full.prompt, encoder);

  const skillCount = mixedSkills.length;
  const descriptionPerSkill = (descriptionOnlyTokens - baseTokens) / skillCount;
  const fullPerSkill = (fullTokens - baseTokens) / skillCount;

  const estimates = [5, 10].map((count) => ({
    skills: count,
    descriptionOnlyEstimate: Math.round(baseTokens + descriptionPerSkill * count),
    fullBodyEstimate: Math.round(baseTokens + fullPerSkill * count),
    estimatedSavings: Math.round((fullPerSkill - descriptionPerSkill) * count),
  }));

  const result = {
    tokenizer: "gpt-4o (fallback: cl100k_base)",
    skillCount,
    basePromptTokens: baseTokens,
    promptVariants: {
      descriptionOnly: descriptionOnlyTokens,
      mixed: mixedTokens,
      fullBody: fullTokens,
    },
    perSkillDelta: {
      descriptionOnly: round(descriptionPerSkill),
      fullBody: round(fullPerSkill),
      savings: round(fullPerSkill - descriptionPerSkill),
    },
    estimates,
  };

  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));

  if ("free" in encoder && typeof encoder.free === "function") {
    encoder.free();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
