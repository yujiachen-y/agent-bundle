import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuildE2BTemplateResult } from "./build-e2b-template.js";
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

describe("runBuildCommand e2b build success", () => {
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
    expect(buildE2BMock.mock.calls[0][0]).not.toHaveProperty("dockerfile");
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

describe("runBuildCommand e2b build dockerfile passthrough", () => {
  it("passes resolved dockerfile to e2b template build when e2b build config is provided", async () => {
    const workspaceDir = await createTempWorkspace("e2b-build-with-dockerfile");
    await writeSkill(workspaceDir);
    const configPath = await writeBundleConfig(
      workspaceDir,
      createBundleConfig({
        sandboxLines: [
          "  provider: e2b",
          "  e2b:",
          "    template: code-formatter",
          "    build:",
          "      dockerfile: ./e2b.Dockerfile",
        ],
      }),
    );

    const buildE2BMock = vi.fn(async (): Promise<BuildE2BTemplateResult> => {
      return {
        templateRef: "code-formatter:a3f8c2d",
        exitCode: 0,
      };
    });

    await runBuildCommand(
      {
        configPath,
        outputDir: join(workspaceDir, "dist"),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      },
      {
        buildE2B: buildE2BMock,
      },
    );

    expect(buildE2BMock).toHaveBeenCalledTimes(1);
    expect(buildE2BMock.mock.calls[0][0]).toHaveProperty(
      "dockerfile",
      resolve(workspaceDir, "./e2b.Dockerfile"),
    );
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
