import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";

import { type BundleConfig, parseBundleConfig } from "../schema/bundle.js";

function parseYamlOrThrow(fileContents: string, configPath: string): unknown {
  try {
    return parse(fileContents);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown YAML parse error.";
    throw new Error(`Failed to parse YAML at ${configPath}: ${message}`);
  }
}

export async function loadBundleConfig(configPath: string): Promise<BundleConfig> {
  const absolutePath = resolve(configPath);
  const fileContents = await readFile(absolutePath, "utf8");
  const rawConfig = parseYamlOrThrow(fileContents, absolutePath);
  return parseBundleConfig(rawConfig);
}
