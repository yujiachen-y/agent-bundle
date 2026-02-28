import { PassThrough } from "node:stream";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ensureExecdBaseImage, resolveExecdRuntimeDependencies } from "./execd-base-image.js";
import type { BuildSandboxImageResult } from "./sandbox-image.js";

class MockInspectProcess {
  private closeListeners: Array<(code: number | null) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];

  public on(event: "close", listener: (code: number | null) => void): this;
  public on(event: "error", listener: (error: Error) => void): this;
  public on(
    event: "close" | "error",
    listener: ((code: number | null) => void) | ((error: Error) => void),
  ): this {
    if (event === "close") {
      this.closeListeners.push(listener as (code: number | null) => void);
      return this;
    }

    this.errorListeners.push(listener as (error: Error) => void);
    return this;
  }

  public emitClose(code: number | null): void {
    this.closeListeners.forEach((listener) => {
      listener(code);
    });
  }

  public emitError(error: Error): void {
    this.errorListeners.forEach((listener) => {
      listener(error);
    });
  }
}

describe("resolveExecdRuntimeDependencies", () => {
  it("uses provided runtime hooks when supplied", async () => {
    const getPackageVersion = vi.fn(async (): Promise<string> => "9.9.9");
    const inspectDockerImage = vi.fn(async (): Promise<boolean> => true);

    const runtime = resolveExecdRuntimeDependencies({
      getPackageVersion,
      inspectDockerImage,
      moduleUrl: "file:///repo/dist/cli/build/build.js",
    });

    await expect(runtime.getPackageVersion()).resolves.toBe("9.9.9");
    await expect(runtime.inspectDockerImage("agent-bundle/execd:9.9.9")).resolves.toBe(true);
    expect(inspectDockerImage).toHaveBeenCalledWith("agent-bundle/execd:9.9.9");
    expect(runtime.moduleUrl).toBe("file:///repo/dist/cli/build/build.js");
  });

  it("resolves package version from package.json by default", async () => {
    const readFileMock = vi.fn(async (): Promise<string> => {
      return JSON.stringify({ version: "1.2.3" });
    });

    const runtime = resolveExecdRuntimeDependencies({
      readFileImpl: readFileMock as unknown as typeof import("node:fs/promises").readFile,
      moduleUrl: "file:///repo/dist/cli/build/execd-base-image.js",
    });

    await expect(runtime.getPackageVersion()).resolves.toBe("1.2.3");
    expect(readFileMock).toHaveBeenCalledWith(resolve("/repo", "package.json"), "utf8");
  });

  it("throws when package.json version is missing", async () => {
    const runtime = resolveExecdRuntimeDependencies({
      readFileImpl: vi.fn(async (): Promise<string> => "{}") as unknown as typeof import("node:fs/promises").readFile,
      moduleUrl: "file:///repo/dist/cli/build/execd-base-image.js",
    });

    await expect(runtime.getPackageVersion()).rejects.toThrowError("Invalid or missing \"version\"");
  });

  it("uses docker image inspect and maps exit code to boolean", async () => {
    const inspectProcess = new MockInspectProcess();
    const spawnMock = vi.fn(() => inspectProcess);
    const runtime = resolveExecdRuntimeDependencies({
      inspectSpawnImpl: spawnMock,
    });

    const existsPromise = runtime.inspectDockerImage("agent-bundle/execd:1.2.3");
    inspectProcess.emitClose(0);
    await expect(existsPromise).resolves.toBe(true);

    const missingProcess = new MockInspectProcess();
    spawnMock.mockImplementationOnce(() => missingProcess);
    const missingPromise = runtime.inspectDockerImage("agent-bundle/execd:1.2.4");
    missingProcess.emitClose(1);
    await expect(missingPromise).resolves.toBe(false);

    expect(spawnMock).toHaveBeenCalledWith(
      "docker",
      ["image", "inspect", "agent-bundle/execd:1.2.3"],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
  });

  it("surfaces inspect spawn errors", async () => {
    const inspectProcess = new MockInspectProcess();
    const runtime = resolveExecdRuntimeDependencies({
      inspectSpawnImpl: vi.fn(() => inspectProcess),
    });

    const inspectPromise = runtime.inspectDockerImage("agent-bundle/execd:1.2.3");
    inspectProcess.emitError(new Error("spawn ENOENT"));

    await expect(inspectPromise).rejects.toThrowError(
      "Failed to inspect docker image agent-bundle/execd:1.2.3: spawn ENOENT",
    );
  });
});

describe("ensureExecdBaseImage", () => {
  it("skips build when cached base image exists", async () => {
    const stdout = new PassThrough();
    let output = "";
    stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });
    const buildSandbox = vi.fn(async (): Promise<BuildSandboxImageResult> => {
      return { imageTag: "unused", exitCode: 0 };
    });

    const imageTag = await ensureExecdBaseImage({
      buildSandbox,
      stdout,
      stderr: new PassThrough(),
      runtime: {
        getPackageVersion: async (): Promise<string> => "0.1.0",
        inspectDockerImage: async (): Promise<boolean> => true,
        moduleUrl: "file:///repo/dist/cli/build/build.js",
      },
    });

    expect(imageTag).toBe("agent-bundle/execd:0.1.0");
    expect(buildSandbox).not.toHaveBeenCalled();
    expect(output).toContain("Using cached execd base image: agent-bundle/execd:0.1.0");
  });

  it("builds base image when cache is missing", async () => {
    const buildSandbox = vi.fn(async (): Promise<BuildSandboxImageResult> => {
      return { imageTag: "agent-bundle/execd:0.1.0", exitCode: 0 };
    });

    const imageTag = await ensureExecdBaseImage({
      buildSandbox,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      runtime: {
        getPackageVersion: async (): Promise<string> => "0.1.0",
        inspectDockerImage: async (): Promise<boolean> => false,
        moduleUrl: "file:///repo/dist/cli/build/build.js",
      },
    });

    expect(imageTag).toBe("agent-bundle/execd:0.1.0");
    expect(buildSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleDir: resolve("/repo", "dist", "execd"),
        dockerfile: "Dockerfile",
        imageTag: "agent-bundle/execd:0.1.0",
      }),
    );
  });

  it("throws when docker build fails", async () => {
    const buildSandbox = vi.fn(async (): Promise<BuildSandboxImageResult> => {
      return { imageTag: "agent-bundle/execd:0.1.0", exitCode: 7 };
    });

    await expect(
      ensureExecdBaseImage({
        buildSandbox,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        runtime: {
          getPackageVersion: async (): Promise<string> => "0.1.0",
          inspectDockerImage: async (): Promise<boolean> => false,
          moduleUrl: "file:///repo/dist/cli/build/build.js",
        },
      }),
    ).rejects.toThrowError("docker build failed with exit code 7.");
  });
});
