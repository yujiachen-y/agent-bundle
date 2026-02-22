import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Skill } from "../skills/loader.js";
import {
  buildE2BTemplate,
  type SpawnLike,
} from "./build-e2b-template.js";

const CREATED_DIRS: string[] = [];

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

async function createTempWorkspace(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `agent-bundle-e2b-test-${name}-`));
  CREATED_DIRS.push(directory);
  return directory;
}

async function createLocalSkill(workspaceDir: string): Promise<Skill> {
  const skillDir = join(workspaceDir, "skills", "format-code");
  await mkdir(skillDir, { recursive: true });

  await writeFile(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: Format Code",
      "description: Format source code in sandbox",
      "---",
      "Use the formatter.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(skillDir, "format.py"), "print('format')\n", "utf8");

  return {
    name: "Format Code",
    description: "Format source code in sandbox",
    content: [
      "---",
      "name: Format Code",
      "description: Format source code in sandbox",
      "---",
      "Use the formatter.",
      "",
    ].join("\n"),
    sourcePath: join(skillDir, "SKILL.md"),
  };
}

function createRemoteSkill(): Skill {
  return {
    name: "Remote Skill",
    description: "Loaded from remote registry",
    content: [
      "---",
      "name: Remote Skill",
      "description: Loaded from remote registry",
      "---",
      "Use remote logic.",
      "",
    ].join("\n"),
    sourcePath: "https://example.com/skills/remote/SKILL.md",
  };
}

async function expectPathMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("buildE2BTemplate args and build context", () => {
  it("creates temp context with skills/tools and spawns e2b template build", async () => {
    const workspaceDir = await createTempWorkspace("context");
    const localSkill = await createLocalSkill(workspaceDir);
    const remoteSkill = createRemoteSkill();

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
      bundleDir: workspaceDir,
      template: "code-formatter",
      skills: [localSkill, remoteSkill],
      spawnImpl: spawnMock,
      stdout,
      stderr,
    });

    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });
    const spawnCall = spawnMock.mock.calls[0];
    const contextDir = spawnCall[1][3];

    expect(spawnCall[0]).toBe("e2b");
    expect(spawnCall[1]).toEqual([
      "template",
      "build",
      "--path",
      contextDir,
      "code-formatter",
    ]);
    expect(spawnCall[2]).toEqual({ stdio: ["ignore", "pipe", "pipe"] });

    const dockerfile = await readFile(join(contextDir, "e2b.Dockerfile"), "utf8");
    const localSkillFile = await readFile(join(contextDir, "skills/01-format-code/SKILL.md"), "utf8");
    const localScriptFile = await readFile(join(contextDir, "skills/01-format-code/format.py"), "utf8");
    const remoteSkillFile = await readFile(join(contextDir, "skills/02-remote-skill/SKILL.md"), "utf8");
    await stat(join(contextDir, "tools"));

    expect(dockerfile).toContain("FROM e2bdev/base:latest");
    expect(localSkillFile).toContain("name: Format Code");
    expect(localScriptFile).toContain("print('format')");
    expect(remoteSkillFile).toContain("name: Remote Skill");

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
    await expectPathMissing(contextDir);
  });

  it("falls back to configured template when output has no matching ref", async () => {
    const workspaceDir = await createTempWorkspace("fallback");
    const localSkill = await createLocalSkill(workspaceDir);
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildE2BTemplate({
      bundleDir: workspaceDir,
      template: "code-formatter",
      skills: [localSkill],
      spawnImpl: spawnMock,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1);
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
    const workspaceDir = await createTempWorkspace("non-zero");
    const localSkill = await createLocalSkill(workspaceDir);
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildE2BTemplate({
      bundleDir: workspaceDir,
      template: "code-formatter",
      skills: [localSkill],
      spawnImpl: spawnMock,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });
    processMock.emitClose(12);

    const result = await buildPromise;
    expect(result).toEqual({
      templateRef: "code-formatter",
      exitCode: 12,
    });
  });

  it("rejects when spawn emits error", async () => {
    const workspaceDir = await createTempWorkspace("spawn-error");
    const localSkill = await createLocalSkill(workspaceDir);
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildE2BTemplate({
      bundleDir: workspaceDir,
      template: "code-formatter",
      skills: [localSkill],
      spawnImpl: spawnMock,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });
    processMock.emitError(new Error("spawn ENOENT"));

    await expect(buildPromise).rejects.toThrowError(
      "Failed to start e2b template build: spawn ENOENT",
    );
  });
});
