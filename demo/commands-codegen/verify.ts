/**
 * E2E verification for command codegen pipeline.
 *
 * Runs the generate command programmatically, then verifies the generated
 * source contains expected patterns (withCommands, command type, method names).
 *
 * Usage: npx tsx demo/commands-codegen/verify.ts
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";

import { runGenerateCommand } from "../../src/cli/generate/generate.js";

const DEMO_DIR = resolve(import.meta.dirname);
const CONFIG_PATH = join(DEMO_DIR, "agent-bundle.yaml");
const OUTPUT_DIR = join(DEMO_DIR, ".generated");

async function verify(): Promise<void> {
  console.log("Running generate command...");
  const result = await runGenerateCommand({
    configPath: CONFIG_PATH,
    outputDir: OUTPUT_DIR,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });

  console.log(`Generated output at: ${result.outputDir}`);

  const indexSource = await readFile(join(result.outputDir, "index.ts"), "utf8");
  const typesSource = await readFile(join(result.outputDir, "types.ts"), "utf8");

  const checks: Array<[string, string, string]> = [
    // [description, source, expected pattern]
    ["index.ts imports withCommands", indexSource, "withCommands"],
    ["index.ts has _factory", indexSource, "_factory"],
    ["index.ts has _commandDefs", indexSource, "_commandDefs"],
    ["index.ts has quickAnalysis method name", indexSource, "quickAnalysis"],
    ["index.ts has command content with $ARGUMENTS", indexSource, "$ARGUMENTS"],
    ["index.ts exports DemoAnalystCommands type", indexSource, "DemoAnalystCommands"],
    ["index.ts exports DemoAnalystAgent type", indexSource, "DemoAnalystAgent"],
    ["index.ts has wrapper factory with spread", indexSource, "..._factory"],
    ["types.ts has DemoAnalystVariables", typesSource, "DemoAnalystVariables"],
    ["types.ts has DemoAnalystCommands", typesSource, "DemoAnalystCommands"],
    ["types.ts has DemoAnalystAgent", typesSource, "DemoAnalystAgent"],
  ];

  let passed = 0;
  let failed = 0;

  for (const [description, source, pattern] of checks) {
    if (source.includes(pattern)) {
      console.log(`  PASS: ${description}`);
      passed++;
    } else {
      console.error(`  FAIL: ${description} (expected "${pattern}")`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }

  console.log("\nAll checks passed!");
}

verify().catch((error) => {
  console.error("Verification failed:", error);
  process.exit(1);
});
