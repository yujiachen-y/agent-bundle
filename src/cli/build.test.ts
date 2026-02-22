import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuildE2BTemplateResult } from "./build-e2b-template.js";
import type { BuildSandboxImageResult } from "./build-sandbox-image.js";
import { runBuildCommand } from "./build.js";

const CREATED_DIRS: string[] = [];

type BundleConfigInput = {
  sandboxLines: string[];
  promptVariables?: string[];
};

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

function createBundleConfig(input: BundleConfigInput): string {
  const promptVariableLines = input.promptVariables && input.promptVariables.length > 0
    ? ["  variables:", ...input.promptVariables.map((name) => `    - ${name}`)]
    : ["  variables: []"];

  return [
    "name: code-formatter",
    "model:",
    "  provider: anthropic",
    "  model: claude-sonnet-4-20250514",
    "prompt:",
    "  system: You are a formatter.",
    ...promptVariableLines,
    "sandbox:",
    ...input.sandboxLines,
    "skills:",
    "  - path: ./skills/format-code",
  ].join("\n");
}

async function writeBundleConfig(workspaceDir: string, contents: string): Promise<string> {
  const configPath = join(workspaceDir, "agent-bundle.yaml");
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

describe("runBuildCommand success path with docker build", () => {
  it("builds artifacts and invokes docker build for kubernetes build config", async () => {
    const workspaceDir = await createTempWorkspace("build");
    await writeSkill(workspaceDir);

    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
        promptVariables: ["user_name"],
        sandboxLines: [
          "  provider: kubernetes",
          "  kubernetes:",
          "    image: agent-bundle/execd:latest",
          "    build:",
          "      dockerfile: ./Dockerfile",
          "      context: .",
        ],
      }),
    );

    const buildSandboxMock = vi.fn(async (): Promise<BuildSandboxImageResult> => {
      return { imageTag: "agent-bundle/execd:latest", exitCode: 0 };
    });
    const stdout = new PassThrough();
    let output = "";

    stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    const result = await runBuildCommand(
      {
        configPath,
        outputDir: join(workspaceDir, "dist"),
        stdout,
        stderr: new PassThrough(),
      },
      {
        buildSandbox: buildSandboxMock,
      },
    );

    expect(buildSandboxMock).toHaveBeenCalledTimes(1);
    expect(output).toContain("Building bundle \"code-formatter\"");
    expect(output).toContain("Build completed:");

    const indexSource = await readFile(join(result.outputDir, "index.ts"), "utf8");
    const typesSource = await readFile(join(result.outputDir, "types.ts"), "utf8");
    const bundleJsonSource = await readFile(join(result.outputDir, "bundle.json"), "utf8");

    expect(indexSource).toContain("export const CodeFormatter = defineAgent");
    expect(typesSource).toContain("export interface CodeFormatterVariables");

    const bundleJson = JSON.parse(bundleJsonSource) as {
      sandboxImage: {
        provider: string;
        ref: string;
      };
      sandbox: {
        kubernetes?: {
          image?: string;
        };
      };
      skills: Array<{ name: string }>;
    };
    expect(bundleJson.sandboxImage).toEqual({
      provider: "kubernetes",
      ref: "agent-bundle/execd:latest",
    });
    expect(bundleJson.sandbox.kubernetes?.image).toBe("agent-bundle/execd:latest");
    expect(bundleJson.skills[0].name).toBe("FormatCode");
  });
});

describe("runBuildCommand success path without docker build", () => {
  it("skips docker build when kubernetes.build is absent", async () => {
    const workspaceDir = await createTempWorkspace("skip-build");
    await writeSkill(workspaceDir);
    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
        sandboxLines: [
          "  provider: kubernetes",
          "  kubernetes:",
          "    image: agent-bundle/execd:latest",
        ],
      }),
    );

    const buildSandboxMock = vi.fn(async (): Promise<BuildSandboxImageResult> => {
      return { imageTag: "unused", exitCode: 0 };
    });

    await runBuildCommand(
      {
        configPath,
        outputDir: join(workspaceDir, "dist"),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      },
      {
        buildSandbox: buildSandboxMock,
      },
    );

    expect(buildSandboxMock).not.toHaveBeenCalled();
  });
});

describe("runBuildCommand success path with e2b build", () => {
  it("builds artifacts and invokes e2b template build for e2b provider", async () => {
    const workspaceDir = await createTempWorkspace("e2b-build");
    await writeSkill(workspaceDir);
    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
        sandboxLines: [
          "  provider: e2b",
          "  e2b:",
          "    template: code-formatter",
        ],
      }),
    );

    const buildE2BMock = vi.fn(async (): Promise<BuildE2BTemplateResult> => {
      return {
        templateRef: "code-formatter:a3f8c2d",
        exitCode: 0,
      };
    });
    const stdout = new PassThrough();
    let output = "";

    stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    const result = await runBuildCommand(
      {
        configPath,
        outputDir: join(workspaceDir, "dist"),
        stdout,
        stderr: new PassThrough(),
      },
      {
        buildE2B: buildE2BMock,
      },
    );

    expect(buildE2BMock).toHaveBeenCalledTimes(1);
    expect(buildE2BMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleDir: workspaceDir,
        template: "code-formatter",
        skills: expect.arrayContaining([
          expect.objectContaining({
            name: "FormatCode",
          }),
        ]),
      }),
    );
    expect(output).toContain("Building sandbox template with E2B: code-formatter");
    expect(output).toContain("Build completed:");

    const bundleJsonSource = await readFile(join(result.outputDir, "bundle.json"), "utf8");
    const bundleJson = JSON.parse(bundleJsonSource) as {
      sandboxImage: {
        provider: string;
        ref: string;
      };
      sandbox: {
        e2b?: {
          template?: string;
        };
      };
    };
    expect(bundleJson.sandboxImage).toEqual({
      provider: "e2b",
      ref: "code-formatter:a3f8c2d",
    });
    expect(bundleJson.sandbox.e2b?.template).toBe("code-formatter:a3f8c2d");
  });
});

describe("runBuildCommand kubernetes validation errors", () => {
  it("throws when kubernetes provider is missing image", async () => {
    const workspaceDir = await createTempWorkspace("missing-image");
    await writeSkill(workspaceDir);
    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
        sandboxLines: [
          "  provider: kubernetes",
          "  kubernetes:",
          "    build:",
          "      dockerfile: ./Dockerfile",
        ],
      }),
    );

    await expect(
      runBuildCommand(
        {
          configPath,
          outputDir: join(workspaceDir, "dist"),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
        },
        {
          buildSandbox: vi.fn(async (): Promise<BuildSandboxImageResult> => {
            return { imageTag: "unused", exitCode: 0 };
          }),
        },
      ),
    ).rejects.toThrowError("sandbox.kubernetes.image is required");
  });
});

describe("runBuildCommand e2b validation errors", () => {
  it("throws when e2b template is absent", async () => {
    const workspaceDir = await createTempWorkspace("e2b");
    await writeSkill(workspaceDir);
    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
        sandboxLines: ["  provider: e2b"],
      }),
    );

    await expect(
      runBuildCommand({
        configPath,
        outputDir: join(workspaceDir, "dist"),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }),
    ).rejects.toThrowError("sandbox.e2b.template is required when sandbox provider is e2b.");
  });

  it("throws when e2b template build exits non-zero", async () => {
    const workspaceDir = await createTempWorkspace("e2b-build-fail");
    await writeSkill(workspaceDir);
    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
        sandboxLines: [
          "  provider: e2b",
          "  e2b:",
          "    template: code-formatter",
        ],
      }),
    );

    const buildE2BMock = vi.fn(async (): Promise<BuildE2BTemplateResult> => {
      return {
        templateRef: "code-formatter",
        exitCode: 9,
      };
    });

    await expect(
      runBuildCommand(
        {
          configPath,
          outputDir: join(workspaceDir, "dist"),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
        },
        {
          buildE2B: buildE2BMock,
        },
      ),
    ).rejects.toThrowError("e2b template build failed with exit code 9.");
    expect(buildE2BMock).toHaveBeenCalledTimes(1);
  });
});
