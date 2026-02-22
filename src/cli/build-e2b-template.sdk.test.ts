import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupTempWorkspaces,
  createLocalSkill,
  createTempWorkspace,
  MockSpawnedProcess,
} from "./build-e2b-template.test-helpers.js";
import { buildE2BTemplate, type SpawnLike } from "./build-e2b-template.js";

afterEach(async () => {
  await cleanupTempWorkspaces();
});

describe("buildE2BTemplate SDK path", () => {
  it("uses E2B Template SDK by default and does not invoke CLI fallback", async () => {
    const workspaceDir = await createTempWorkspace("sdk");
    const localSkill = await createLocalSkill(workspaceDir);
    const spawnMock = vi.fn<SpawnLike>(() => {
      return new MockSpawnedProcess();
    });
    const templateBuildMock = vi.fn(async (_template, _name, options) => {
      options?.onBuildLogs?.({
        toString: () => "sdk build log",
      });
      return {
        name: "code-formatter:a3f8c2d",
      };
    });
    const stdout = new PassThrough();
    let output = "";

    stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    const result = await buildE2BTemplate({
      bundleDir: workspaceDir,
      template: "code-formatter",
      skills: [localSkill],
      templateBuildImpl: templateBuildMock,
      spawnImpl: spawnMock,
      stdout,
      stderr: new PassThrough(),
    });

    expect(result).toEqual({
      templateRef: "code-formatter:a3f8c2d",
      exitCode: 0,
    });
    expect(templateBuildMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(output).toContain("sdk build log");
  });
});
