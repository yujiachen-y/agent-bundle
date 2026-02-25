import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadBundleConfig } from "./load-bundle-config.js";

const CREATED_DIRS: string[] = [];

async function createTempConfig(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-bundle-cli-"));
  CREATED_DIRS.push(directory);
  const configPath = join(directory, "agent-bundle.yaml");
  await writeFile(configPath, contents, "utf8");
  return configPath;
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("loadBundleConfig", () => {
  it("loads and validates a YAML bundle config", async () => {
    const configPath = await createTempConfig(`
name: invoice-processor
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
prompt:
  system: You are helpful.
sandbox:
  provider: e2b
skills:
  - path: ./skills/invoice
`);

    const config = await loadBundleConfig(configPath);

    expect(config.name).toBe("invoice-processor");
    expect(config.sandbox.timeout).toBe(900);
  });

  it("throws when YAML syntax is invalid", async () => {
    const configPath = await createTempConfig("name: invoice-processor: invalid");

    await expect(loadBundleConfig(configPath)).rejects.toThrowError(
      /^Failed to parse YAML at .*agent-bundle\.yaml:/,
    );
  });
});
