import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { runGenerateCommand } from "./generate.js";

const CREATED_DIRS: string[] = [];

async function createTempWorkspace(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `agent-bundle-${name}-`));
  CREATED_DIRS.push(directory);
  return directory;
}

async function writeSkill(workspaceDir: string): Promise<void> {
  const skillPath = join(workspaceDir, "skills", "format-code", "SKILL.md");
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(
    skillPath,
    [
      "---",
      "name: FormatCode",
      "description: Format source code in sandbox",
      "---",
      "Use the formatter.",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeBundleConfig(workspaceDir: string, contents: string): Promise<string> {
  const configPath = join(workspaceDir, "agent-bundle.yaml");
  await writeFile(configPath, contents, "utf8");
  return configPath;
}

const MINIMAL_CONFIG = [
  "name: code-formatter",
  "model:",
  "  provider: anthropic",
  "  model: claude-sonnet-4-20250514",
  "prompt:",
  "  system: You are a formatter.",
  "  variables:",
  "    - user_name",
  "sandbox:",
  "  provider: kubernetes",
  "  kubernetes:",
  "    image: agent-bundle/execd:latest",
  "skills:",
  "  - path: ./skills/format-code",
].join("\n");

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("runGenerateCommand default output path", () => {
  it("writes to node_modules/@agent-bundle/<name>/ by default", async () => {
    const workspaceDir = await createTempWorkspace("gen-default");
    await writeSkill(workspaceDir);
    // Create a package.json so resolveProjectRoot finds this dir
    await writeFile(join(workspaceDir, "package.json"), "{}", "utf8");
    const configPath = await writeBundleConfig(workspaceDir, MINIMAL_CONFIG);

    const stdout = new PassThrough();
    let output = "";
    stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    const result = await runGenerateCommand({
      configPath,
      stdout,
      stderr: new PassThrough(),
    });

    const expectedDir = join(workspaceDir, "node_modules", "@agent-bundle", "code-formatter");
    expect(result.outputDir).toBe(expectedDir);
    expect(output).toContain('Generating bundle "code-formatter"');
    expect(output).toContain("Generate completed:");

    const indexSource = await readFile(join(result.outputDir, "index.ts"), "utf8");
    expect(indexSource).toContain("export const CodeFormatter = defineAgent");

    const packageJsonSource = await readFile(join(result.outputDir, "package.json"), "utf8");
    const parsed = JSON.parse(packageJsonSource) as { name: string };
    expect(parsed.name).toBe("@agent-bundle/code-formatter");

    // Self-link should be created so agent-bundle/runtime resolves
    const selfLinkPath = join(workspaceDir, "node_modules", "agent-bundle");
    const stat = await lstat(selfLinkPath);
    expect(stat.isSymbolicLink()).toBe(true);
    const target = await readlink(selfLinkPath);
    expect(target).toBe(workspaceDir);
  });
});

describe("runGenerateCommand with --output override", () => {
  it("writes to custom output directory when --output is specified", async () => {
    const workspaceDir = await createTempWorkspace("gen-output");
    await writeSkill(workspaceDir);
    const configPath = await writeBundleConfig(workspaceDir, MINIMAL_CONFIG);
    const customOutput = join(workspaceDir, "custom-dist");

    const result = await runGenerateCommand({
      configPath,
      outputDir: customOutput,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    expect(result.outputDir).toBe(join(customOutput, "code-formatter"));

    const indexSource = await readFile(join(result.outputDir, "index.ts"), "utf8");
    expect(indexSource).toContain("export const CodeFormatter = defineAgent");
  });
});

describe("runGenerateCommand does not trigger docker build", () => {
  it("reads sandbox image from config without building", async () => {
    const workspaceDir = await createTempWorkspace("gen-no-docker");
    await writeSkill(workspaceDir);
    await writeFile(join(workspaceDir, "package.json"), "{}", "utf8");

    // Config has kubernetes.build section, but generate should ignore it
    const configWithBuild = [
      "name: code-formatter",
      "model:",
      "  provider: anthropic",
      "  model: claude-sonnet-4-20250514",
      "prompt:",
      "  system: You are a formatter.",
      "  variables: []",
      "sandbox:",
      "  provider: kubernetes",
      "  kubernetes:",
      "    image: agent-bundle/execd:latest",
      "    build:",
      "      dockerfile: ./Dockerfile",
      "      context: .",
      "skills:",
      "  - path: ./skills/format-code",
    ].join("\n");

    const configPath = await writeBundleConfig(workspaceDir, configWithBuild);

    const result = await runGenerateCommand({
      configPath,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    // Should succeed without docker — image ref comes directly from config
    const bundleJsonSource = await readFile(join(result.outputDir, "bundle.json"), "utf8");
    const bundleJson = JSON.parse(bundleJsonSource) as {
      sandboxImage: { provider: string; ref: string };
    };
    expect(bundleJson.sandboxImage).toEqual({
      provider: "kubernetes",
      ref: "agent-bundle/execd:latest",
    });
  });

  it("uses default docker image ref when docker provider omits image", async () => {
    const workspaceDir = await createTempWorkspace("gen-docker-default-image");
    await writeSkill(workspaceDir);
    await writeFile(join(workspaceDir, "package.json"), "{}", "utf8");
    const configPath = await writeBundleConfig(
      workspaceDir,
      [
        "name: code-formatter",
        "model:",
        "  provider: anthropic",
        "  model: claude-sonnet-4-20250514",
        "prompt:",
        "  system: You are a formatter.",
        "  variables: []",
        "sandbox:",
        "  provider: docker",
        "  docker: {}",
        "skills:",
        "  - path: ./skills/format-code",
      ].join("\n"),
    );

    const result = await runGenerateCommand({
      configPath,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    const bundleJsonSource = await readFile(join(result.outputDir, "bundle.json"), "utf8");
    const bundleJson = JSON.parse(bundleJsonSource) as {
      sandboxImage: { provider: string; ref: string };
      sandbox: { docker?: { image?: string } };
    };
    expect(bundleJson.sandboxImage).toEqual({
      provider: "docker",
      ref: "agent-bundle/execd:latest",
    });
    expect(bundleJson.sandbox.docker?.image).toBe("agent-bundle/execd:latest");
  });
});

describe("runGenerateCommand validation errors", () => {
  it("throws when kubernetes provider is missing image", async () => {
    const workspaceDir = await createTempWorkspace("gen-missing-image");
    await writeSkill(workspaceDir);
    const configPath = await writeBundleConfig(
      workspaceDir,
      [
        "name: code-formatter",
        "model:",
        "  provider: anthropic",
        "  model: claude-sonnet-4-20250514",
        "prompt:",
        "  system: You are a formatter.",
        "  variables: []",
        "sandbox:",
        "  provider: kubernetes",
        "  kubernetes:",
        "    build:",
        "      dockerfile: ./Dockerfile",
        "skills:",
        "  - path: ./skills/format-code",
      ].join("\n"),
    );

    await expect(
      runGenerateCommand({
        configPath,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }),
    ).rejects.toThrowError("sandbox.kubernetes.image is required");
  });
});
