import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Skill } from "../../../skills/loader.js";
import { copySkillResources, writeSkillsBuildContext, writeToolsBuildContext } from "./build-context.js";

const CREATED_DIRS: string[] = [];

async function createTempDirectory(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `agent-bundle-build-context-${name}-`));
  CREATED_DIRS.push(directory);
  return directory;
}

function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "Format Code",
    description: "Format source code in sandbox",
    content: "---\nname: Format Code\ndescription: Format source code in sandbox\n---\nBody\n",
    sourcePath: "/tmp/unused/SKILL.md",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("copySkillResources", () => {
  it("copies files when skill.resourceDir exists", async () => {
    const workspaceDir = await createTempDirectory("copy-resources");
    const resourceDir = join(workspaceDir, "skill-resources");
    const destinationDir = join(workspaceDir, "dest");

    await mkdir(join(resourceDir, "nested"), { recursive: true });
    await mkdir(destinationDir, { recursive: true });
    await writeFile(join(resourceDir, "SKILL.md"), "ignore\n", "utf8");
    await writeFile(join(resourceDir, "format.py"), "print('format')\n", "utf8");
    await writeFile(join(resourceDir, "nested", "rules.json"), '{"tabWidth": 2}\n', "utf8");

    await copySkillResources(createSkill({ resourceDir }), destinationDir);

    await expect(readFile(join(destinationDir, "format.py"), "utf8")).resolves.toContain("print('format')");
    await expect(readFile(join(destinationDir, "nested", "rules.json"), "utf8")).resolves.toContain("tabWidth");
    await expect(readFile(join(destinationDir, "SKILL.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips copy when skill.resourceDir is undefined", async () => {
    const workspaceDir = await createTempDirectory("skip-resources");
    const destinationDir = join(workspaceDir, "dest");
    await mkdir(destinationDir, { recursive: true });

    await expect(copySkillResources(createSkill(), destinationDir)).resolves.toBeUndefined();
    await expect(readdir(destinationDir)).resolves.toEqual([]);
  });
});

describe("writeSkillsBuildContext", () => {
  it("creates numbered skill dirs with markdown and optional resources", async () => {
    const workspaceDir = await createTempDirectory("skills-context");
    const contextDir = join(workspaceDir, "context");
    const localResourceDir = join(workspaceDir, "local-resource");

    await mkdir(localResourceDir, { recursive: true });
    await writeFile(join(localResourceDir, "helper.py"), "print('helper')\n", "utf8");

    const localSkill = createSkill({
      name: "Format Code",
      content: "---\nname: Format Code\ndescription: Format source code in sandbox\n---\nLocal\n",
      resourceDir: localResourceDir,
      sourcePath: join(localResourceDir, "SKILL.md"),
    });
    const remoteSkill = createSkill({
      name: "Remote Skill",
      content: "---\nname: Remote Skill\ndescription: Loaded remotely\n---\nRemote\n",
      sourcePath: "https://example.com/skills/remote/SKILL.md",
      resourceDir: undefined,
    });

    await writeSkillsBuildContext(contextDir, [localSkill, remoteSkill]);

    await expect(readFile(join(contextDir, "skills", "01-format-code", "SKILL.md"), "utf8")).resolves.toContain(
      "name: Format Code",
    );
    await expect(readFile(join(contextDir, "skills", "01-format-code", "helper.py"), "utf8")).resolves.toContain(
      "helper",
    );
    await expect(readFile(join(contextDir, "skills", "02-remote-skill", "SKILL.md"), "utf8")).resolves.toContain(
      "name: Remote Skill",
    );
  });

  it("replaces existing skills directory instead of merging", async () => {
    const workspaceDir = await createTempDirectory("replace-skills");
    const contextDir = join(workspaceDir, "context");
    await mkdir(join(contextDir, "skills", "legacy"), { recursive: true });
    await writeFile(join(contextDir, "skills", "legacy", "old.txt"), "old\n", "utf8");

    await writeSkillsBuildContext(contextDir, [createSkill()]);

    await expect(readFile(join(contextDir, "skills", "legacy", "old.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(contextDir, "skills", "01-format-code", "SKILL.md"), "utf8")).resolves.toContain(
      "name: Format Code",
    );
  });
});

describe("writeToolsBuildContext", () => {
  it("replaces existing tools directory instead of merging", async () => {
    const workspaceDir = await createTempDirectory("replace-tools");
    const contextDir = join(workspaceDir, "context");
    const bundleDir = join(workspaceDir, "bundle");

    await mkdir(join(contextDir, "tools"), { recursive: true });
    await writeFile(join(contextDir, "tools", "legacy.txt"), "legacy\n", "utf8");
    await mkdir(join(bundleDir, "tools"), { recursive: true });
    await writeFile(join(bundleDir, "tools", "setup.sh"), "echo setup\n", "utf8");

    await writeToolsBuildContext(contextDir, bundleDir);

    await expect(readFile(join(contextDir, "tools", "legacy.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(contextDir, "tools", "setup.sh"), "utf8")).resolves.toContain("echo setup");
  });
});
