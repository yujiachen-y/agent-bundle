import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { K8sSandbox } from "./kubernetes.js";

const execFileAsync = promisify(execFile);
const E2E_ENABLED = process.env.K8S_SANDBOX_E2E === "1";
const describeIfE2E = E2E_ENABLED ? describe : describe.skip;
const E2E_IMAGE = process.env.K8S_SANDBOX_E2E_IMAGE ?? "sandbox:spike";
const E2E_NAMESPACE = process.env.K8S_SANDBOX_E2E_NAMESPACE ?? "default";

async function cleanupSandboxPods(): Promise<void> {
  try {
    await execFileAsync(
      "kubectl",
      [
        "delete",
        "pods",
        "-n",
        E2E_NAMESPACE,
        "-l",
        "app=agent-sandbox",
        "--ignore-not-found=true",
      ],
      { timeout: 120_000 },
    );
  } catch (error) {
    // Best-effort cleanup. Failing cleanup should not mask the actual test result.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[k8s-e2e] cleanup warning: ${message}`);
  }
}

function createE2EConfig() {
  return {
    provider: "kubernetes" as const,
    timeout: 120,
    resources: {
      cpu: 0.5,
      memory: "512Mi",
    },
    kubernetes: {
      namespace: E2E_NAMESPACE,
      image: E2E_IMAGE,
    },
  };
}

describeIfE2E("K8sSandbox E2E", () => {
  beforeAll(async () => {
    await cleanupSandboxPods();
  }, 60_000);

  afterAll(async () => {
    await cleanupSandboxPods();
  }, 60_000);

  it("runs lifecycle, hooks, and file roundtrip against local cluster", async () => {
    let preUnmountArtifact = "";
    const sandbox = new K8sSandbox(createE2EConfig(), {
      preMount: async (io) => {
        await io.file.write("/skills/process.py", [
          "from pathlib import Path",
          "Path('/workspace/result.txt').write_text('processed-by-python\\n', encoding='utf-8')",
          "print('process-ok')",
          "",
        ].join("\n"));
        await io.file.write("/workspace/to-delete.txt", "delete-me");
      },
      preUnmount: async (io) => {
        preUnmountArtifact = await io.file.read("/workspace/result.txt");
      },
    });

    try {
      await sandbox.start();
      expect(sandbox.status).toBe("ready");

      const execResult = await sandbox.exec("python3 /skills/process.py");
      expect(execResult.exitCode).toBe(0);
      expect(execResult.stdout).toContain("process-ok");

      const resultContent = await sandbox.file.read("/workspace/result.txt");
      expect(resultContent).toContain("processed-by-python");

      await sandbox.file.delete("/workspace/to-delete.txt");
      await expect(sandbox.file.read("/workspace/to-delete.txt")).rejects.toThrow(/HTTP 404/);

      const listed = await sandbox.file.list("/workspace");
      expect(listed.some((entry) => entry.path.endsWith("/result.txt"))).toBe(true);
    } finally {
      await sandbox.shutdown();
    }

    expect(sandbox.status).toBe("stopped");
    expect(preUnmountArtifact).toContain("processed-by-python");
  }, 180_000);

  it("returns non-zero command exit codes in real pod execution", async () => {
    const sandbox = new K8sSandbox(createE2EConfig());
    try {
      await sandbox.start();
      const execResult = await sandbox.exec("python3 -c \"import sys; sys.exit(17)\"");
      expect(execResult.exitCode).toBe(17);
    } finally {
      await sandbox.shutdown();
    }
  }, 120_000);
});
