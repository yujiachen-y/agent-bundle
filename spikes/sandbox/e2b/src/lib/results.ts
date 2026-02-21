import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { RESULTS_DIR } from "./paths.js";
import { nowIso } from "./utils/time.js";

export async function writeResultFile(mode: string, result: unknown): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true });

  const timestamp = nowIso().replace(/[:.]/g, "-");
  const outputPath = path.resolve(RESULTS_DIR, `${timestamp}-${mode}.json`);
  const latestPath = path.resolve(RESULTS_DIR, `latest-${mode}.json`);
  const payload = `${JSON.stringify(result, null, 2)}\n`;

  await writeFile(outputPath, payload, "utf8");
  await writeFile(latestPath, payload, "utf8");

  return outputPath;
}
