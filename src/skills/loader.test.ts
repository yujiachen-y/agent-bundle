import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAllSkills, loadSkill } from "./loader.js";

const CREATED_DIRS: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-bundle-skills-"));
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

describe("loadAllSkills", () => {
  it("loads local skills relative to basePath", async () => {
    const basePath = await createTempDirectory();
    const skillDir = join(basePath, "skills", "extract-line-items");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: Extract Line Items
description: Parse invoice rows from OCR output.
---
Use this skill for invoice extraction.
`,
      "utf8",
    );

    const skills = await loadAllSkills([{ path: "./skills/extract-line-items" }], basePath);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: "Extract Line Items",
      description: "Parse invoice rows from OCR output.",
      sourcePath: join(basePath, "skills", "extract-line-items", "SKILL.md"),
    });
  });
});

describe("loadSkill frontmatter validation", () => {
  it("throws when required frontmatter fields are missing", async () => {
    const basePath = await createTempDirectory();
    const skillDir = join(basePath, "skills", "broken-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: Broken Skill
---
Missing description field.
`,
      "utf8",
    );

    await expect(
      loadSkill(
        { path: "./skills/broken-skill" },
        {
          basePath,
        },
      ),
    ).rejects.toThrowError(
      /must define a non-empty frontmatter field: description/,
    );
  });
});

describe("loadSkill remote loading and cache", () => {
  it("uses cache on repeated requests", async () => {
    const workspaceDir = await createTempDirectory();
    const cacheDir = join(workspaceDir, "cache");
    const markdown = `---
name: OCR Skill
description: Extract text from images.
---
Skill body.
`;
    const fetchMock = vi.fn(async () => new Response(markdown, { status: 200 }));

    await loadSkill(
      { url: "https://registry.example.com/skills/ocr" },
      {
        cache: true,
        cacheDir,
        fetchImpl: fetchMock,
      },
    );
    const secondLoad = await loadSkill(
      { url: "https://registry.example.com/skills/ocr" },
      {
        cache: true,
        cacheDir,
        fetchImpl: fetchMock,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://registry.example.com/skills/ocr/SKILL.md");
    expect(secondLoad.name).toBe("OCR Skill");
    await expect(readdir(cacheDir)).resolves.toHaveLength(1);
  });

  it("builds GitHub raw URL using default ref", async () => {
    const markdown = `---
name: GitHub Skill
description: Test skill.
---
Skill body.
`;
    const fetchMock = vi.fn(async () => new Response(markdown, { status: 200 }));

    await loadSkill(
      { github: "acme/invoice-skills", skill: "extract-line-items", ref: "main" },
      {
        cache: false,
        fetchImpl: fetchMock,
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/acme/invoice-skills/main/extract-line-items/SKILL.md",
    );
  });
});
