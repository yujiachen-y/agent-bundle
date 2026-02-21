import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSkill } from "./loader.js";

const NETWORK_E2E_ENABLED = process.env.SKILLS_LOADER_E2E === "1";
const describeIfNetworkEnabled = NETWORK_E2E_ENABLED ? describe : describe.skip;

const CREATED_DIRS: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-bundle-skills-e2e-"));
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

describeIfNetworkEnabled("loadSkill E2E", () => {
  it("loads local SKILL.md from filesystem without mocks", async () => {
    const workspaceRoot = await createTempDirectory();
    const skillDir = join(workspaceRoot, "skills", "local-e2e");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: local-e2e-skill
description: Local E2E skill for loader validation.
---
# Local E2E Skill
`,
      "utf8",
    );

    const skill = await loadSkill(
      { path: "./skills/local-e2e" },
      { basePath: workspaceRoot },
    );
    expect(skill.name).toBe("local-e2e-skill");
    expect(skill.description).toBe("Local E2E skill for loader validation.");
    expect(skill.sourcePath).toBe(join(workspaceRoot, "skills", "local-e2e", "SKILL.md"));
    expect(skill.content).toContain("# Local E2E Skill");
  }, 20_000);

  it("loads GitHub skill from vercel-labs/agent-skills", async () => {
    const skill = await loadSkill(
      {
        github: "vercel-labs/agent-skills",
        skill: "skills/react-best-practices",
        ref: "main",
      },
      { cache: false },
    );

    expect(skill.name).toBe("vercel-react-best-practices");
    expect(skill.description).toContain("React and Next.js performance optimization");
    expect(skill.sourcePath).toBe(
      "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md",
    );
    expect(skill.content).toContain("# Vercel React Best Practices");
  }, 40_000);

  it("loads URL skill by appending /SKILL.md when url has no .md suffix", async () => {
    const skill = await loadSkill(
      {
        url: "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/composition-patterns",
      },
      { cache: false },
    );

    expect(skill.name).toBe("vercel-composition-patterns");
    expect(skill.description).toContain("React composition patterns that scale");
    expect(skill.sourcePath).toBe(
      "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/composition-patterns/SKILL.md",
    );
    expect(skill.content).toContain("# React Composition Patterns");
  }, 40_000);
});
