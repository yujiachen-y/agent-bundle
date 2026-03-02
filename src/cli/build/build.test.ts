import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuildSandboxImageResult } from "./sandbox-image.js";
import { runBuildCommand } from "./build.js";
import {
  cleanupTempWorkspaces,
  createBundleConfig,
  createTempWorkspace,
  writeBundleConfig,
  writeSkill,
} from "./build.test-helpers.js";

afterEach(async () => {
  await cleanupTempWorkspaces();
});

describe("runBuildCommand success path with docker build", () => {
  it("builds execd base image when missing and passes BASE_IMAGE to kubernetes build", async () => {
    const workspaceDir = await createTempWorkspace("build");
    await writeSkill(workspaceDir);
    await writeFile(join(workspaceDir, "Dockerfile"), "FROM scratch\n", "utf8");
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

    const buildSandboxMock = vi.fn(async (options: { imageTag: string }): Promise<BuildSandboxImageResult> => {
      return { imageTag: options.imageTag, exitCode: 0 };
    });
    const getPackageVersionMock = vi.fn(async (): Promise<string> => "0.1.0");
    const inspectDockerImageMock = vi.fn(async (): Promise<boolean> => false);
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
        getPackageVersion: getPackageVersionMock,
        inspectDockerImage: inspectDockerImageMock,
      },
    );

    expect(inspectDockerImageMock).toHaveBeenCalledWith("agent-bundle/execd:0.1.0");
    expect(buildSandboxMock).toHaveBeenCalledTimes(2);
    const firstBuildCall = buildSandboxMock.mock.calls[0]?.[0] as {
      bundleDir: string;
      dockerfile: string;
      imageTag: string;
    };
    const secondBuildCall = buildSandboxMock.mock.calls[1]?.[0] as {
      imageTag: string;
      buildArgs?: Record<string, string>;
    };
    expect(firstBuildCall.imageTag).toBe("agent-bundle/execd:0.1.0");
    expect(firstBuildCall.dockerfile).toBe("Dockerfile");
    expect(firstBuildCall.bundleDir).toMatch(/[/\\]dist[/\\]execd$/);
    expect(secondBuildCall.imageTag).toBe("agent-bundle/execd:latest");
    expect(secondBuildCall.buildArgs).toEqual({
      BASE_IMAGE: "agent-bundle/execd:0.1.0",
    });
    expect(output).toContain("Building bundle \"code-formatter\"");
    expect(output).toContain("Building execd base image with Docker: agent-bundle/execd:0.1.0");
    expect(output).toContain("Build completed:");

    const bundleJsonSource = await readFile(join(result.outputDir, "bundle.json"), "utf8");
    const bundleJson = JSON.parse(bundleJsonSource) as {
      sandboxImage: { provider: string; ref: string };
      sandbox: { kubernetes?: { image?: string } };
    };
    expect(bundleJson.sandboxImage).toEqual({
      provider: "kubernetes",
      ref: "agent-bundle/execd:latest",
    });
    expect(bundleJson.sandbox.kubernetes?.image).toBe("agent-bundle/execd:latest");
  });
});

describe("runBuildCommand merges kubernetes build context", () => {
  it("builds kubernetes image from merged context with injected skills and tools", async () => {
    const workspaceDir = await createTempWorkspace("merged-context");
    await writeSkill(workspaceDir);
    await writeFile(
      join(workspaceDir, "Dockerfile"),
      ["FROM scratch", "RUN echo merged-context", ""].join("\n"),
      "utf8",
    );
    await mkdir(join(workspaceDir, "tools"), { recursive: true });
    await writeFile(join(workspaceDir, "tools", "setup.sh"), "echo setup\n", "utf8");
    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
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

    let mergedContextDir = "";
    let mergedDockerfile = "";
    let mergedSkill = "";
    let mergedTool = "";
    const buildSandboxMock = vi.fn(
      async (options: {
        bundleDir: string;
        dockerfile: string;
        imageTag: string;
      }): Promise<BuildSandboxImageResult> => {
        if (options.imageTag === "agent-bundle/execd:latest") {
          mergedContextDir = options.bundleDir;
          mergedDockerfile = await readFile(join(options.bundleDir, options.dockerfile), "utf8");
          const generatedSkillDirs = await readdir(join(options.bundleDir, "skills"));
          expect(generatedSkillDirs).toHaveLength(1);
          mergedSkill = await readFile(
            join(options.bundleDir, "skills", generatedSkillDirs[0], "SKILL.md"),
            "utf8",
          );
          mergedTool = await readFile(join(options.bundleDir, "tools", "setup.sh"), "utf8");
        }

        return { imageTag: options.imageTag, exitCode: 0 };
      },
    );

    await runBuildCommand(
      {
        configPath,
        outputDir: join(workspaceDir, "dist"),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      },
      {
        buildSandbox: buildSandboxMock,
        getPackageVersion: async (): Promise<string> => "0.1.0",
        inspectDockerImage: async (): Promise<boolean> => false,
      },
    );

    expect(mergedDockerfile).toContain("RUN echo merged-context");
    expect(mergedSkill).toContain("name: FormatCode");
    expect(mergedTool).toContain("echo setup");
    await expect(readFile(join(mergedContextDir, "Dockerfile"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("runBuildCommand success path with cached execd base image", () => {
  it("reuses cached execd base image when available locally", async () => {
    const workspaceDir = await createTempWorkspace("cached-base");
    await writeSkill(workspaceDir);
    await writeFile(join(workspaceDir, "Dockerfile"), "FROM scratch\n", "utf8");
    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
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
    const buildSandboxMock = vi.fn(async (options: { imageTag: string }): Promise<BuildSandboxImageResult> => {
      return { imageTag: options.imageTag, exitCode: 0 };
    });
    const inspectDockerImageMock = vi.fn(async (): Promise<boolean> => true);

    await runBuildCommand(
      {
        configPath,
        outputDir: join(workspaceDir, "dist"),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      },
      {
        buildSandbox: buildSandboxMock,
        getPackageVersion: async (): Promise<string> => "0.1.0",
        inspectDockerImage: inspectDockerImageMock,
      },
    );

    expect(inspectDockerImageMock).toHaveBeenCalledWith("agent-bundle/execd:0.1.0");
    expect(buildSandboxMock).toHaveBeenCalledTimes(1);
    expect(buildSandboxMock.mock.calls[0]?.[0]).toMatchObject({
      imageTag: "agent-bundle/execd:latest",
      buildArgs: {
        BASE_IMAGE: "agent-bundle/execd:0.1.0",
      },
    });
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
