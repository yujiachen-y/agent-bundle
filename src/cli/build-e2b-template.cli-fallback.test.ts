import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupTempWorkspaces,
  createLocalSkill,
  createRemoteSkill,
  createTempWorkspace,
  statPath,
  MockSpawnedProcess,
  withTemporaryEnv,
} from "./build-e2b-template.test-helpers.js";
import { buildE2BTemplate, type SpawnLike } from "./build-e2b-template.js";

const DEFAULT_DOCKERFILE_CONTENT = [
  "FROM e2bdev/base:latest",
  "RUN mkdir -p /skills /tools /workspace",
  "COPY ./skills/ /skills/",
  "COPY ./tools/ /tools/",
  "RUN if [ -f /tools/setup.sh ]; then chmod +x /tools/setup.sh && /tools/setup.sh; fi",
  "",
].join("\n");

async function writeTestDockerfile(workspaceDir: string): Promise<string> {
  const dockerfilePath = join(workspaceDir, "e2b.Dockerfile");
  await writeFile(dockerfilePath, DEFAULT_DOCKERFILE_CONTENT, "utf8");
  return dockerfilePath;
}

function throwSdkUnavailable(): never {
  throw new Error("sdk unavailable");
}

async function waitForSpawnCall(spawnMock: ReturnType<typeof vi.fn>): Promise<{
  spawnCall: Parameters<SpawnLike>;
  contextDir: string;
}> {
  await vi.waitFor(() => {
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  const spawnCall = spawnMock.mock.calls[0] as Parameters<SpawnLike>;
  return {
    spawnCall,
    contextDir: spawnCall[1][3],
  };
}

async function assertFallbackBuildContext(contextDir: string): Promise<void> {
  const dockerfile = await readFile(join(contextDir, "e2b.Dockerfile"), "utf8");
  const localSkillFile = await readFile(join(contextDir, "skills/01-format-code/SKILL.md"), "utf8");
  const localScriptFile = await readFile(join(contextDir, "skills/01-format-code/format.py"), "utf8");
  const remoteSkillFile = await readFile(join(contextDir, "skills/02-remote-skill/SKILL.md"), "utf8");
  await stat(join(contextDir, "tools"));

  expect(dockerfile).toContain("FROM e2bdev/base:latest");
  expect(localSkillFile).toContain("name: Format Code");
  expect(localScriptFile).toContain("print('format')");
  expect(remoteSkillFile).toContain("name: Remote Skill");
}

afterEach(async () => {
  await cleanupTempWorkspaces();
});

describe("buildE2BTemplate CLI fallback context setup", () => {
  it("creates temp context with skills/tools and falls back to e2b CLI when SDK build fails", async () => {
    const workspaceDir = await createTempWorkspace("fallback");
    const dockerfilePath = await writeTestDockerfile(workspaceDir);
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
      skills: [await createLocalSkill(workspaceDir), createRemoteSkill()],
      dockerfile: dockerfilePath,
      templateBuildImpl: vi.fn(throwSdkUnavailable),
      spawnImpl: spawnMock,
      stdout,
      stderr,
    });

    const { spawnCall, contextDir } = await waitForSpawnCall(spawnMock);
    expect(spawnCall[0]).toBe("e2b");
    expect(spawnCall[1]).toEqual([
      "template",
      "build",
      "--path",
      contextDir,
      "code-formatter",
    ]);
    expect(spawnCall[2]).toEqual(expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }));
    await assertFallbackBuildContext(contextDir);

    processMock.stdout.write("step digest sha256:deadbeef\n");
    processMock.stdout.write("published code-formatter:a3f8c2d\n");
    processMock.stderr.write("warning output\n");
    processMock.emitClose(0);

    await expect(buildPromise).resolves.toEqual({
      templateRef: "code-formatter:a3f8c2d",
      exitCode: 0,
    });
    expect(stdoutText).toContain("published code-formatter:a3f8c2d");
    expect(stderrText).toContain("E2B SDK template build failed");
    await expect(statPath(contextDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("buildE2BTemplate CLI fallback dockerfile selection", () => {
  it("falls back to configured template when CLI output has no matching ref", async () => {
    const workspaceDir = await createTempWorkspace("no-ref");
    const dockerfilePath = await writeTestDockerfile(workspaceDir);
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildE2BTemplate({
      bundleDir: workspaceDir,
      template: "code-formatter",
      skills: [await createLocalSkill(workspaceDir)],
      dockerfile: dockerfilePath,
      templateBuildImpl: vi.fn(throwSdkUnavailable),
      spawnImpl: spawnMock,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    await waitForSpawnCall(spawnMock);
    processMock.stdout.write("build complete\n");
    processMock.emitClose(0);

    await expect(buildPromise).resolves.toEqual({
      templateRef: "code-formatter",
      exitCode: 0,
    });
  });

  it("uses provided dockerfile when creating fallback context", async () => {
    const workspaceDir = await createTempWorkspace("custom-dockerfile");
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);
    const customDockerfilePath = join(workspaceDir, "e2b.custom.Dockerfile");

    await writeFile(
      customDockerfilePath,
      ["FROM e2bdev/base:latest", "RUN echo custom-dockerfile", ""].join("\n"),
      "utf8",
    );

    const buildPromise = buildE2BTemplate({
      bundleDir: workspaceDir,
      template: "code-formatter",
      skills: [await createLocalSkill(workspaceDir)],
      dockerfile: customDockerfilePath,
      templateBuildImpl: vi.fn(throwSdkUnavailable),
      spawnImpl: spawnMock,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    const { contextDir } = await waitForSpawnCall(spawnMock);
    const dockerfile = await readFile(join(contextDir, "e2b.Dockerfile"), "utf8");
    expect(dockerfile).toContain("RUN echo custom-dockerfile");
    expect(dockerfile).not.toContain("COPY ./skills/ /skills/");

    processMock.emitClose(0);
    await expect(buildPromise).resolves.toEqual({
      templateRef: "code-formatter",
      exitCode: 0,
    });
  });
});

describe("buildE2BTemplate CLI fallback auth", () => {
  it("maps E2B_API_KEY into E2B_ACCESS_TOKEN for CLI fallback", async () => {
    const workspaceDir = await createTempWorkspace("auth-map");
    const dockerfilePath = await writeTestDockerfile(workspaceDir);
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);
    const restoreEnv = withTemporaryEnv({
      E2B_API_KEY: "api-key-for-tests",
      E2B_ACCESS_TOKEN: undefined,
    });

    try {
      const buildPromise = buildE2BTemplate({
        bundleDir: workspaceDir,
        template: "code-formatter",
        skills: [await createLocalSkill(workspaceDir)],
        dockerfile: dockerfilePath,
        templateBuildImpl: vi.fn(throwSdkUnavailable),
        spawnImpl: spawnMock,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });

      const { spawnCall } = await waitForSpawnCall(spawnMock);
      expect(spawnCall[2].env?.E2B_ACCESS_TOKEN).toBe("api-key-for-tests");
      processMock.emitClose(0);

      await expect(buildPromise).resolves.toEqual({
        templateRef: "code-formatter",
        exitCode: 0,
      });
    } finally {
      restoreEnv();
    }
  });
});

describe("buildE2BTemplate failures", () => {
  it("returns non-zero exit code when CLI fallback exits non-zero", async () => {
    const workspaceDir = await createTempWorkspace("non-zero");
    const dockerfilePath = await writeTestDockerfile(workspaceDir);
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildE2BTemplate({
      bundleDir: workspaceDir,
      template: "code-formatter",
      skills: [await createLocalSkill(workspaceDir)],
      dockerfile: dockerfilePath,
      templateBuildImpl: vi.fn(throwSdkUnavailable),
      spawnImpl: spawnMock,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    await waitForSpawnCall(spawnMock);
    processMock.emitClose(12);

    await expect(buildPromise).resolves.toEqual({
      templateRef: "code-formatter",
      exitCode: 12,
    });
  });

  it("rejects when CLI fallback spawn emits error", async () => {
    const workspaceDir = await createTempWorkspace("spawn-error");
    const dockerfilePath = await writeTestDockerfile(workspaceDir);
    const processMock = new MockSpawnedProcess();
    const spawnMock = vi.fn<SpawnLike>(() => processMock);

    const buildPromise = buildE2BTemplate({
      bundleDir: workspaceDir,
      template: "code-formatter",
      skills: [await createLocalSkill(workspaceDir)],
      dockerfile: dockerfilePath,
      templateBuildImpl: vi.fn(throwSdkUnavailable),
      spawnImpl: spawnMock,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });

    await waitForSpawnCall(spawnMock);
    processMock.emitError(new Error("spawn ENOENT"));

    await expect(buildPromise).rejects.toThrowError(
      "Failed to start e2b template build: spawn ENOENT",
    );
  });
});
