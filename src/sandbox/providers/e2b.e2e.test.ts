import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { E2BSandbox } from "./e2b.js";

const E2E_ENABLED = process.env.E2B_SANDBOX_E2E === "1";
const describeIfE2E = E2E_ENABLED ? describe : describe.skip;

function createE2EConfig() {
  return {
    provider: "e2b" as const,
    timeout: 120,
    resources: {
      cpu: 2,
      memory: "512MB",
    },
    e2b: process.env.E2B_SANDBOX_E2E_TEMPLATE
      ? {
          template: process.env.E2B_SANDBOX_E2E_TEMPLATE,
        }
      : undefined,
  };
}

describeIfE2E("E2BSandbox E2E", () => {
  let sandbox: E2BSandbox | null = null;

  beforeAll(() => {
    if (!process.env.E2B_API_KEY) {
      throw new Error("E2B_API_KEY is required for E2B_SANDBOX_E2E tests.");
    }
  });

  afterAll(async () => {
    if (sandbox !== null) {
      await sandbox.shutdown();
      sandbox = null;
    }
  }, 60_000);

  it("runs lifecycle hooks and file/exec roundtrip against real E2B sandbox", async () => {
    let preUnmountArtifact = "";
    sandbox = new E2BSandbox(createE2EConfig(), {
      preMount: async (io) => {
        await io.file.write("/tmp/pre-mount.txt", "from-pre-mount\n");
        await io.file.write("/tmp/delete-target.txt", "delete-me\n");
      },
      preUnmount: async (io) => {
        preUnmountArtifact = await io.file.read("/tmp/runtime.txt");
      },
    });

    try {
      await sandbox.start();
      expect(sandbox.status).toBe("ready");

      const preMountExec = await sandbox.exec("cat /tmp/pre-mount.txt");
      expect(preMountExec.exitCode).toBe(0);
      expect(preMountExec.stdout).toContain("from-pre-mount");

      await sandbox.file.write("/tmp/runtime.txt", "runtime-content\n");
      const runtimeRead = await sandbox.file.read("/tmp/runtime.txt");
      expect(runtimeRead).toContain("runtime-content");

      const listed = await sandbox.file.list("/tmp");
      expect(listed.some((entry) => entry.path === "/tmp/runtime.txt")).toBe(true);

      await sandbox.file.delete("/tmp/delete-target.txt");
      await expect(sandbox.file.read("/tmp/delete-target.txt")).rejects.toThrow();
    } finally {
      await sandbox.shutdown();
      sandbox = null;
    }

    expect(preUnmountArtifact).toContain("runtime-content");
  }, 180_000);

  it("returns non-zero command exit codes", async () => {
    sandbox = new E2BSandbox(createE2EConfig());

    try {
      await sandbox.start();
      const failed = await sandbox.exec("sh -c 'exit 17'");
      expect(failed.exitCode).toBe(17);
    } finally {
      await sandbox.shutdown();
      sandbox = null;
    }
  }, 120_000);
});
