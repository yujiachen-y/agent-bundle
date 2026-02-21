import { beforeEach, describe, expect, it, vi } from "vitest";

const createSandboxMock = vi.fn();

vi.mock("e2b", () => ({
  Sandbox: {
    create: createSandboxMock,
  },
}));

const { runI1 } = await import("./i1.js");

function makeSandbox() {
  return {
    sandboxId: "sbx_i1",
    files: {
      write: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue("processed\n"),
      list: vi.fn().mockResolvedValue([{ path: "/workspace/output.txt" }]),
    },
    commands: {
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    },
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

describe("runI1", () => {
  beforeEach(() => {
    createSandboxMock.mockReset();
  });

  it("runs the i1 flow and returns captured output", async () => {
    const sandbox = makeSandbox();
    createSandboxMock.mockResolvedValue(sandbox);

    const result = await runI1();

    expect(result.sandboxId).toBe("sbx_i1");
    expect(result.outputText).toBe("processed\n");
    expect(result.workspaceEntries).toEqual(["/workspace/output.txt"]);
    expect(result.timings.map((timing) => timing.step)).toEqual([
      "create_sandbox",
      "write_skill_file",
      "write_input_file",
      "run_command",
      "read_output_file",
      "list_workspace",
      "destroy_sandbox",
    ]);
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
  });

  it("kills the sandbox in finally when a step fails", async () => {
    const sandbox = makeSandbox();
    sandbox.files.write.mockRejectedValueOnce(new Error("write failed"));
    createSandboxMock.mockResolvedValue(sandbox);

    await expect(runI1()).rejects.toThrowError("write failed");
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
  });
});
