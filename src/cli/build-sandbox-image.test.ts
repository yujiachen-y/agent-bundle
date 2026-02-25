import { dirname, resolve } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  buildSandboxImage,
  type SpawnLike,
} from "./build-sandbox-image.js";

class MockSpawnedProcess {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();

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

describe("buildSandboxImage args and streaming", () => {
  it("spawns docker build with provided context", async () => {
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let stdoutText = "";
    let stderrText = "";

    stdout.on("data", (chunk: Buffer | string) => {
      stdoutText += chunk.toString();
    });
    stderr.on("data", (chunk: Buffer | string) => {
      stderrText += chunk.toString();
    });

    const buildPromise = buildSandboxImage({
      bundleDir: "/repo/demo/server/k8s",
      dockerfile: "../../packages/execd/Dockerfile",
      context: "../../packages/execd",
      imageTag: "agent-bundle/execd:latest",
      spawnImpl: spawnMock,
      stdout,
      stderr,
    });

    processMock.stdout.write("building\n");
    processMock.stderr.write("warning\n");
    processMock.emitClose(0);

    const result = await buildPromise;

    expect(result).toEqual({
      imageTag: "agent-bundle/execd:latest",
      exitCode: 0,
    });
    expect(stdoutText).toContain("building");
    expect(stderrText).toContain("warning");
    expect(spawnMock).toHaveBeenCalledWith(
      "docker",
      [
        "build",
        "-t",
        "agent-bundle/execd:latest",
        "-f",
        resolve("/repo/demo/server/k8s", "../../packages/execd/Dockerfile"),
        resolve("/repo/demo/server/k8s", "../../packages/execd"),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  });

  it("defaults context to dockerfile directory", async () => {
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildSandboxImage({
      bundleDir: "/repo/demo/server/k8s",
      dockerfile: "../../packages/execd/Dockerfile",
      imageTag: "agent-bundle/execd:latest",
      spawnImpl: spawnMock,
    });

    processMock.emitClose(0);

    await buildPromise;

    const resolvedDockerfile = resolve(
      "/repo/demo/server/k8s",
      "../../packages/execd/Dockerfile",
    );
    expect(spawnMock).toHaveBeenCalledWith(
      "docker",
      [
        "build",
        "-t",
        "agent-bundle/execd:latest",
        "-f",
        resolvedDockerfile,
        dirname(resolvedDockerfile),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  });
});

describe("buildSandboxImage failures", () => {
  it("returns non-zero exit code when docker build fails", async () => {
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildSandboxImage({
      bundleDir: "/repo",
      dockerfile: "./Dockerfile",
      context: ".",
      imageTag: "agent-bundle/execd:latest",
      spawnImpl: spawnMock,
    });

    processMock.emitClose(17);

    const result = await buildPromise;
    expect(result.exitCode).toBe(17);
  });

  it("rejects when spawn emits error", async () => {
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildSandboxImage({
      bundleDir: "/repo",
      dockerfile: "./Dockerfile",
      context: ".",
      imageTag: "agent-bundle/execd:latest",
      spawnImpl: spawnMock,
    });

    processMock.emitError(new Error("spawn ENOENT"));

    await expect(buildPromise).rejects.toThrowError(
      "Failed to start docker build: spawn ENOENT",
    );
  });
});
