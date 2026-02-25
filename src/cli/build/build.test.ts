import { readFile } from "node:fs/promises";
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
    const packageJsonSource = await readFile(join(result.outputDir, "package.json"), "utf8");

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

    const packageJson = JSON.parse(packageJsonSource) as { name: string; dependencies: Record<string, string> };
    expect(packageJson.name).toBe("@agent-bundle/code-formatter");
    expect(packageJson.dependencies).toEqual({ "agent-bundle": "*" });
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
