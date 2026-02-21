import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_CONTEXT_PLACEHOLDER,
  buildSystemPromptTemplate,
  generateSystemPromptFromBundle,
  loadBundleConfig,
  loadSkillsFromBundle,
  writePromptTemplate,
} from "../src/lib/system-prompt-builder.mjs";

const tempDirs = [];

async function makeTempDir() {
  const directory = await mkdtemp(join(tmpdir(), "system-prompt-builder-"));
  tempDirs.push(directory);
  return directory;
}

async function writeTextFile(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function writeSkillMarkdown(filePath, options) {
  const lines = ["---"];

  if (typeof options.name === "string") {
    lines.push(`name: ${options.name}`);
  }

  if (typeof options.description === "string") {
    lines.push(`description: ${options.description}`);
  }

  lines.push("---", "", options.body ?? "Default skill body");
  await writeTextFile(filePath, `${lines.join("\n")}\n`);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.map((directory) => {
      return rm(directory, { recursive: true, force: true });
    }),
  );
  tempDirs.length = 0;
});

describe("loadBundleConfig", () => {
  it("loads bundle skills and normalizes prompt modes", async () => {
    const tempDir = await makeTempDir();
    const bundlePath = join(tempDir, "bundle.yaml");
    const bundleYaml = [
      "skills:",
      "  - ./skill-one",
      "  - path: ./skill-two/SKILL.md",
      "    prompt: full",
      "  - path: ./skill-three",
      "    prompt: invalid",
    ].join("\n");

    await writeTextFile(bundlePath, `${bundleYaml}\n`);

    const config = await loadBundleConfig(bundlePath);

    expect(config.bundlePath).toBe(resolve(bundlePath));
    expect(config.bundleDir).toBe(tempDir);
    expect(config.skills).toEqual([
      { path: "./skill-one", prompt: "description" },
      { path: "./skill-two/SKILL.md", prompt: "full" },
      { path: "./skill-three", prompt: "description" },
    ]);
  });

  it("throws when skills is not an array", async () => {
    const tempDir = await makeTempDir();
    const bundlePath = join(tempDir, "bundle.yaml");

    await writeTextFile(bundlePath, "skills: nope\n");

    await expect(loadBundleConfig(bundlePath)).rejects.toThrow("must include a 'skills' array");
  });

  it("throws when a skill object misses a non-empty path", async () => {
    const tempDir = await makeTempDir();
    const bundlePath = join(tempDir, "bundle.yaml");

    await writeTextFile(bundlePath, "skills:\n  - prompt: full\n");

    await expect(loadBundleConfig(bundlePath)).rejects.toThrow("requires a non-empty string `path`");
  });
});

describe("loadSkillsFromBundle", () => {
  it("loads skills from directory and file paths", async () => {
    const tempDir = await makeTempDir();
    const bundlePath = join(tempDir, "bundle.yaml");
    const alphaPath = join(tempDir, "alpha", "SKILL.md");
    const betaPath = join(tempDir, "beta", "SKILL.md");

    await writeSkillMarkdown(alphaPath, {
      name: "Alpha",
      description: "Alpha description",
      body: "Alpha body",
    });
    await writeSkillMarkdown(betaPath, {
      description: "Beta description",
      body: "Beta body",
    });
    await writeTextFile(bundlePath, "skills:\n  - path: ./alpha\n  - path: ./beta/SKILL.md\n    prompt: full\n");

    const skills = await loadSkillsFromBundle(bundlePath);

    expect(skills).toHaveLength(2);
    expect(skills[0]).toMatchObject({
      name: "Alpha",
      description: "Alpha description",
      promptMode: "description",
      localPath: alphaPath,
      containerPath: "/skills/Alpha/SKILL.md",
    });
    expect(skills[1]).toMatchObject({
      name: "beta",
      description: "Beta description",
      promptMode: "full",
      localPath: betaPath,
      containerPath: "/skills/beta/SKILL.md",
    });
    expect(skills[1].body).toContain("Beta body");
  });

  it("overrides prompt mode when forcePromptMode is set", async () => {
    const tempDir = await makeTempDir();
    const bundlePath = join(tempDir, "bundle.yaml");
    const skillPath = join(tempDir, "gamma", "SKILL.md");

    await writeSkillMarkdown(skillPath, {
      description: "Gamma description",
      body: "Gamma body",
    });
    await writeTextFile(bundlePath, "skills:\n  - path: ./gamma\n    prompt: description\n");

    const skills = await loadSkillsFromBundle(bundlePath, { forcePromptMode: "full" });

    expect(skills).toHaveLength(1);
    expect(skills[0].promptMode).toBe("full");
  });

  it("throws when a skill description is missing", async () => {
    const tempDir = await makeTempDir();
    const bundlePath = join(tempDir, "bundle.yaml");
    const skillPath = join(tempDir, "missing-desc", "SKILL.md");

    await writeSkillMarkdown(skillPath, {
      name: "MissingDescription",
      body: "Body only",
    });
    await writeTextFile(bundlePath, "skills:\n  - path: ./missing-desc\n");

    await expect(loadSkillsFromBundle(bundlePath)).rejects.toThrow("missing a non-empty frontmatter description");
  });

  it("throws when a skill directory has no SKILL.md", async () => {
    const tempDir = await makeTempDir();
    const bundlePath = join(tempDir, "bundle.yaml");

    await mkdir(join(tempDir, "empty-skill"), { recursive: true });
    await writeTextFile(bundlePath, "skills:\n  - path: ./empty-skill\n");

    await expect(loadSkillsFromBundle(bundlePath)).rejects.toThrow("Missing SKILL.md in skill directory");
  });
});

describe("buildSystemPromptTemplate", () => {
  it("includes full and description skills with container paths", () => {
    const prompt = buildSystemPromptTemplate({
      skills: [
        {
          name: "One",
          description: "One description",
          body: "One body",
          localPath: "/tmp/one/SKILL.md",
          containerPath: "/skills/One/SKILL.md",
          promptMode: "description",
        },
        {
          name: "Two",
          description: "Two description",
          body: "Two body",
          localPath: "/tmp/two/SKILL.md",
          containerPath: "/skills/Two/SKILL.md",
          promptMode: "full",
        },
      ],
      locationMode: "container",
    });

    expect(prompt).toContain("## Available Skills");
    expect(prompt).toContain("### One");
    expect(prompt).toContain("One description");
    expect(prompt).toContain("Skill file: /skills/One/SKILL.md");
    expect(prompt).toContain("### Two (prompt: full)");
    expect(prompt).toContain("Two body");
    expect(prompt).toContain("## Tools");
    expect(prompt).toContain(SESSION_CONTEXT_PLACEHOLDER);
  });

  it("omits file location lines when locationMode is none", () => {
    const prompt = buildSystemPromptTemplate({
      skills: [
        {
          name: "HiddenPath",
          description: "No path in output",
          body: "Body",
          localPath: "/tmp/local/SKILL.md",
          containerPath: "/skills/HiddenPath/SKILL.md",
          promptMode: "description",
        },
      ],
      locationMode: "none",
    });

    expect(prompt).not.toContain("Skill file:");
  });

  it("renders a fallback message when no skills are configured", () => {
    const prompt = buildSystemPromptTemplate({ skills: [] });

    expect(prompt).toContain("(no skills configured)");
  });
});

describe("generateSystemPromptFromBundle and writePromptTemplate", () => {
  it("builds prompt text from bundle entries and writes output with newline", async () => {
    const tempDir = await makeTempDir();
    const bundlePath = join(tempDir, "bundle.yaml");
    const skillPath = join(tempDir, "writer", "SKILL.md");
    const outputPath = join(tempDir, "nested", "output.txt");

    await writeSkillMarkdown(skillPath, {
      name: "Writer",
      description: "Writer description",
      body: "Writer body",
    });
    await writeTextFile(bundlePath, "skills:\n  - path: ./writer\n    prompt: full\n");

    const generated = await generateSystemPromptFromBundle(bundlePath, {
      locationMode: "local",
      forcePromptMode: "bundle",
    });

    expect(generated.skills).toHaveLength(1);
    expect(generated.skills[0]).toMatchObject({
      name: "Writer",
      promptMode: "full",
      localPath: skillPath,
    });
    expect(generated.prompt).toContain("### Writer (prompt: full)");
    expect(generated.prompt).toContain(`Skill file: ${skillPath}`);

    await writePromptTemplate(outputPath, generated.prompt);

    const written = await readFile(outputPath, "utf8");
    expect(written).toBe(`${generated.prompt}\n`);
  });
});
