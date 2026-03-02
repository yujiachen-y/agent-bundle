import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuildSandboxImageResult } from "../sandbox-image.js";
import { runBuildCommand } from "../build.js";
import {
  cleanupTempWorkspaces,
  createBundleConfig,
  createTempWorkspace,
  writeBundleConfig,
  writeSkill,
} from "../build.test-helpers.js";

afterEach(async () => {
  await cleanupTempWorkspaces();
});

describe("runBuildCommand docker provider skip build", () => {
  it("skips docker build for docker provider and uses default image when omitted", async () => {
    const workspaceDir = await createTempWorkspace("docker-skip-build");
    await writeSkill(workspaceDir);
    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
        sandboxLines: [
          "  provider: docker",
          "  docker: {}",
        ],
      }),
    );

    const buildSandboxMock = vi.fn(async (): Promise<BuildSandboxImageResult> => {
      return { imageTag: "unused", exitCode: 0 };
    });
    const result = await runBuildCommand(
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

describe("runBuildCommand docker provider build", () => {
  it("builds execd base image and docker provider image when docker.build is configured", async () => {
    const workspaceDir = await createTempWorkspace("docker-build");
    await writeSkill(workspaceDir);
    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
        sandboxLines: [
          "  provider: docker",
          "  docker:",
          "    image: agent-bundle/execd:docker",
          "    build:",
          "      dockerfile: ./Dockerfile",
          "      context: .",
        ],
      }),
    );
    const buildSandboxMock = vi.fn(async (options: { imageTag: string }): Promise<BuildSandboxImageResult> => {
      return { imageTag: options.imageTag, exitCode: 0 };
    });
    const result = await runBuildCommand(
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

    expect(buildSandboxMock).toHaveBeenCalledTimes(2);
    expect(buildSandboxMock.mock.calls[1]?.[0]).toMatchObject({
      imageTag: "agent-bundle/execd:docker",
      buildArgs: {
        BASE_IMAGE: "agent-bundle/execd:0.1.0",
      },
    });
    const bundleJsonSource = await readFile(join(result.outputDir, "bundle.json"), "utf8");
    const bundleJson = JSON.parse(bundleJsonSource) as {
      sandboxImage: { provider: string; ref: string };
      sandbox: { docker?: { image?: string } };
    };
    expect(bundleJson.sandboxImage).toEqual({
      provider: "docker",
      ref: "agent-bundle/execd:docker",
    });
    expect(bundleJson.sandbox.docker?.image).toBe("agent-bundle/execd:docker");
  });
});
