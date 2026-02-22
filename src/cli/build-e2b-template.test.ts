import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  buildE2BTemplate,
  type SpawnLike,
} from "./build-e2b-template.js";

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

describe("buildE2BTemplate args and streaming", () => {
  it("spawns e2b template build and extracts template ref from output", async () => {
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

    const buildPromise = buildE2BTemplate({
      bundleDir: "/repo/demo/local-server",
      template: "code-formatter",
      spawnImpl: spawnMock,
      stdout,
      stderr,
    });

    processMock.stdout.write("step digest sha256:deadbeef\n");
    processMock.stdout.write("published code-formatter:a3f8c2d\n");
    processMock.stderr.write("warning output\n");
    processMock.emitClose(0);

    const result = await buildPromise;

    expect(result).toEqual({
      templateRef: "code-formatter:a3f8c2d",
      exitCode: 0,
    });
    expect(stdoutText).toContain("published code-formatter:a3f8c2d");
    expect(stderrText).toContain("warning output");
    expect(spawnMock).toHaveBeenCalledWith(
      "e2b",
      ["template", "build", "--path", "/repo/demo/local-server", "code-formatter"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  });

  it("falls back to configured template when output has no matching ref", async () => {
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildE2BTemplate({
      bundleDir: "/repo",
      template: "code-formatter",
      spawnImpl: spawnMock,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    processMock.stdout.write("build complete\n");
    processMock.emitClose(0);

    const result = await buildPromise;
    expect(result).toEqual({
      templateRef: "code-formatter",
      exitCode: 0,
    });
  });
});

describe("buildE2BTemplate failures", () => {
  it("returns non-zero exit code when template build fails", async () => {
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildE2BTemplate({
      bundleDir: "/repo",
      template: "code-formatter",
      spawnImpl: spawnMock,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    processMock.emitClose(12);

    const result = await buildPromise;
    expect(result).toEqual({
      templateRef: "code-formatter",
      exitCode: 12,
    });
  });

  it("rejects when spawn emits error", async () => {
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildE2BTemplate({
      bundleDir: "/repo",
      template: "code-formatter",
      spawnImpl: spawnMock,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    processMock.emitError(new Error("spawn ENOENT"));

    await expect(buildPromise).rejects.toThrowError(
      "Failed to start e2b template build: spawn ENOENT",
    );
  });
});
