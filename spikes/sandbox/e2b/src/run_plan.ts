import process from "node:process";

import { config as loadEnv } from "dotenv";

import { assertApiKey } from "./lib/env.js";
import { isResultMode, parseMode, runMode } from "./lib/mode_runner.js";
import { ENV_PATH } from "./lib/paths.js";
import { writeResultFile } from "./lib/results.js";
import { formatError } from "./lib/utils/errors.js";

async function main(): Promise<void> {
  loadEnv({ path: ENV_PATH });
  assertApiKey(ENV_PATH);

  const mode = parseMode(process.argv[2]);
  const result = await runMode(mode);

  if (!isResultMode(mode) || result === null) {
    return;
  }

  const outputPath = await writeResultFile(mode, result);
  console.log(JSON.stringify({ outputPath, result }, null, 2));
}

main().catch((error: unknown) => {
  console.error(`[spike] failed: ${formatError(error)}`);
  process.exit(1);
});
