import { resolve } from "node:path";
import { generateSystemPromptFromBundle, writePromptTemplate } from "./lib/system-prompt-builder.mjs";

/**
 * @param {string[]} args
 * @param {string} flag
 * @param {string | undefined} fallback
 * @returns {string | undefined}
 */
function getArg(args, flag, fallback = undefined) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  const bundlePath = resolve(getArg(args, "--bundle", "./bundle.sample.yaml"));
  const outputPath = resolve(getArg(args, "--out", "./dist/system-prompt.txt"));
  const locationMode = getArg(args, "--location", "container");
  const forceMode = getArg(args, "--force-mode", "bundle");

  if (!["container", "local", "none"].includes(locationMode)) {
    throw new Error("--location must be one of: container | local | none");
  }

  if (!["bundle", "description", "full"].includes(forceMode)) {
    throw new Error("--force-mode must be one of: bundle | description | full");
  }

  const { prompt, skills } = await generateSystemPromptFromBundle(bundlePath, {
    locationMode: /** @type {"container" | "local" | "none"} */ (locationMode),
    forcePromptMode: /** @type {"bundle" | "description" | "full"} */ (forceMode),
  });

  await writePromptTemplate(outputPath, prompt);
  console.log(`Generated ${outputPath}`);
  console.log(`Skills included: ${skills.length}`);
  console.log(`Mode: ${forceMode}, location: ${locationMode}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
