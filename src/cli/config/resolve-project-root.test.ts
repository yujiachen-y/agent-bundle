import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveProjectRoot } from "./resolve-project-root.js";

const CREATED_DIRS: string[] = [];

async function createTempDir(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `agent-bundle-${name}-`));
  CREATED_DIRS.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("resolveProjectRoot", () => {
  it("finds project root when package.json exists in start directory", async () => {
    const root = await createTempDir("root");
    await writeFile(join(root, "package.json"), "{}", "utf8");

    const result = await resolveProjectRoot(root);

    expect(result).toBe(root);
  });

  it("finds project root when package.json exists in parent directory", async () => {
    const root = await createTempDir("parent-root");
    await writeFile(join(root, "package.json"), "{}", "utf8");

    const nested = join(root, "src", "cli");
    await mkdir(nested, { recursive: true });

    const result = await resolveProjectRoot(nested);

    expect(result).toBe(root);
  });

  it("returns start directory when no package.json is found", async () => {
    const isolated = await createTempDir("no-pkg");
    // No package.json anywhere in the temp hierarchy up to /tmp
    // The temp dir itself shouldn't have package.json, so walk will hit filesystem root
    // and return the start dir.

    const nested = join(isolated, "deep", "path");
    await mkdir(nested, { recursive: true });

    const result = await resolveProjectRoot(nested);

    expect(result).toBe(nested);
  });
});
