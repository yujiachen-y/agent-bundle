import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SandboxConfig } from "../types.js";

const createSandboxMock = vi.fn();

vi.mock("e2b", () => ({
  FileType: {
    FILE: "file",
    DIR: "dir",
  },
  Sandbox: {
    create: createSandboxMock,
  },
}));

const { E2BSandbox } = await import("./e2b.js");

type MockRuntime = {
  kill: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
  commands: {
    run: ReturnType<typeof vi.fn>;
    sendStdin: ReturnType<typeof vi.fn>;
  };
  files: {
    read: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
};

function makeSandboxConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    provider: "e2b",
    timeout: 90,
    resources: {
      cpu: 2,
      memory: "512MB",
    },
    ...overrides,
  };
}

function makeRuntime(overrides?: Partial<MockRuntime>): MockRuntime {
  return {
    kill: vi.fn(async () => undefined),
    setTimeout: vi.fn(async () => undefined),
    commands: {
      run: vi.fn(async () => ({
        stdout: "stdout",
        stderr: "stderr",
        exitCode: 0,
      })),
      sendStdin: vi.fn(async () => undefined),
    },
    files: {
      read: vi.fn(async () => "content"),
      write: vi.fn(async () => undefined),
      list: vi.fn(async () => [
        { name: "skills", path: "/skills", type: "dir" },
        { name: "SKILL.md", path: "/skills/SKILL.md", type: "file" },
      ]),
    },
    ...overrides,
  };
}

describe("E2BSandbox start", () => {
  it("creates runtime and runs mount hooks in order", async () => {
    const runtime = makeRuntime();
    createSandboxMock.mockResolvedValueOnce(runtime);
    const hookOrder: string[] = [];
    const sandbox = new E2BSandbox(makeSandboxConfig(), {
      preMount: async () => {
        hookOrder.push("preMount");
      },
      postMount: async () => {
        hookOrder.push("postMount");
      },
    });
    expect(sandbox.status).toBe("idle");
    await sandbox.start();
    expect(sandbox.status).toBe("ready");
    expect(hookOrder).toEqual(["preMount", "postMount"]);
    expect(createSandboxMock).toHaveBeenCalledWith({ timeoutMs: 90_000 });
  });
  it("uses E2B template when configured", async () => {
    const runtime = makeRuntime();
    createSandboxMock.mockResolvedValueOnce(runtime);
    const sandbox = new E2BSandbox(
      makeSandboxConfig({
        e2b: { template: "agent-bundle-template" },
      }),
    );
    await sandbox.start();
    expect(createSandboxMock).toHaveBeenCalledWith(
      "agent-bundle-template",
      { timeoutMs: 90_000 },
    );
  });
  it("kills runtime when start fails after creation", async () => {
    const runtime = makeRuntime();
    createSandboxMock.mockResolvedValueOnce(runtime);
    const sandbox = new E2BSandbox(makeSandboxConfig(), {
      preMount: async () => {
        throw new Error("preMount failed");
      },
    });
    await expect(sandbox.start()).rejects.toThrowError("preMount failed");
    expect(runtime.kill).toHaveBeenCalledTimes(1);
    expect(sandbox.status).toBe("stopped");
  });
});

describe("E2BSandbox keepAlive", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  function setupKeepAliveSandbox(overrides?: Partial<MockRuntime>) {
    const runtime = makeRuntime(overrides);
    createSandboxMock.mockResolvedValueOnce(runtime);
    return { runtime, sandbox: new E2BSandbox(makeSandboxConfig({ timeout: 90 })) };
  }
  async function startAndAdvanceKeepAlive(sandbox: E2BSandbox): Promise<void> {
    await sandbox.start();
    await vi.advanceTimersByTimeAsync(45_000);
  }
  it("stops keepAlive timer on shutdown", async () => {
    const { runtime, sandbox } = setupKeepAliveSandbox();
    await startAndAdvanceKeepAlive(sandbox);
    expect(runtime.setTimeout).toHaveBeenCalledWith(90_000);
    await sandbox.shutdown();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(runtime.setTimeout).toHaveBeenCalledTimes(1);
  });
  it("tolerates keepAlive failure", async () => {
    const { runtime, sandbox } = setupKeepAliveSandbox({ setTimeout: vi.fn(async () => { throw new Error("setTimeout failed"); }) });
    await startAndAdvanceKeepAlive(sandbox);
    expect(runtime.setTimeout).toHaveBeenCalledTimes(1);
    expect(sandbox.status).toBe("ready");
    await sandbox.shutdown();
  });
});
describe("E2BSandbox exec and files", () => {
  it("delegates command and file operations to runtime", async () => {
    const runtime = makeRuntime({
      commands: {
        run: vi.fn(async (_command: string, opts?: {
          onStdout?: (chunk: string) => void;
          onStderr?: (chunk: string) => void;
        }) => {
          opts?.onStdout?.("out");
          opts?.onStderr?.("err");
          return {
            stdout: "stdout",
            stderr: "stderr",
            exitCode: 0,
          };
        }),
      },
    });
    createSandboxMock.mockResolvedValueOnce(runtime);
    const sandbox = new E2BSandbox(makeSandboxConfig());
    await sandbox.start();

    const chunks: string[] = [];
    const execResult = await sandbox.exec("echo hello", {
      cwd: "/workspace",
      timeout: 5_000,
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });
    const listed = await sandbox.file.list("/skills");
    await sandbox.file.read("/skills/SKILL.md");
    await sandbox.file.write("/skills/SKILL.md", "updated");
    await sandbox.file.delete("/workspace/temp");

    expect(execResult).toEqual({
      stdout: "stdout",
      stderr: "stderr",
      exitCode: 0,
    });
    expect(chunks).toEqual(["out", "err"]);
    expect(runtime.commands.run).toHaveBeenCalledWith(
      "echo hello",
      expect.objectContaining({
        cwd: "/workspace",
        timeoutMs: 5_000,
      }),
    );
    expect(runtime.files.read).toHaveBeenCalledWith("/skills/SKILL.md", { format: "text" });
    expect(runtime.files.write).toHaveBeenCalledWith("/skills/SKILL.md", "updated");
    expect(listed).toEqual([
      { name: "skills", path: "/skills", type: "directory" },
      { name: "SKILL.md", path: "/skills/SKILL.md", type: "file" },
    ]);
    expect(runtime.commands.run).toHaveBeenCalledWith("rm -rf '/workspace/temp'");
  });

  it("converts command failure result into ExecResult", async () => {
    const runtime = makeRuntime({
      commands: {
        run: vi.fn(async () => {
          throw {
            stdout: "",
            stderr: "boom",
            exitCode: 23,
          };
        }),
      },
    });
    createSandboxMock.mockResolvedValueOnce(runtime);
    const sandbox = new E2BSandbox(makeSandboxConfig());
    await sandbox.start();

    const result = await sandbox.exec("exit 23");
    expect(result).toEqual({
      stdout: "",
      stderr: "boom",
      exitCode: 23,
    });
  });
});

describe("E2BSandbox spawn", () => {
  it("starts background command with stdio streams and forwards stdin", async () => {
    const handle = {
      pid: 42,
      wait: vi.fn(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      })),
      kill: vi.fn(async () => true),
    };
    const runtime = makeRuntime({
      commands: {
        run: vi.fn(async (_command: string, options?: {
          background?: boolean;
          stdin?: boolean;
          onStdout?: (data: string) => Promise<void>;
          onStderr?: (data: string) => Promise<void>;
          cwd?: string;
          envs?: Record<string, string>;
        }) => {
          if (options?.background) {
            await options.onStdout?.("spawn-out");
            await options.onStderr?.("spawn-err");
            return handle;
          }

          return {
            stdout: "stdout",
            stderr: "stderr",
            exitCode: 0,
          };
        }),
        sendStdin: vi.fn(async () => undefined),
      },
    });
    createSandboxMock.mockResolvedValueOnce(runtime);
    const sandbox = new E2BSandbox(makeSandboxConfig());
    await sandbox.start();

    const process = await sandbox.spawn("node", ["server.js"], {
      cwd: "/workspace",
      env: { NODE_ENV: "test" },
    });

    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();
    const stdoutChunk = await stdoutReader.read();
    const stderrChunk = await stderrReader.read();
    stdoutReader.releaseLock();
    stderrReader.releaseLock();

    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode("hello"));
    await writer.close();
    writer.releaseLock();

    await process.kill();
    const exitCode = await process.exited;

    expect(runtime.commands.run).toHaveBeenCalledWith(
      "'node' 'server.js'",
      expect.objectContaining({
        background: true,
        stdin: true,
        cwd: "/workspace",
        envs: { NODE_ENV: "test" },
      }),
    );
    expect(runtime.commands.sendStdin).toHaveBeenCalledWith(42, "hello");
    expect(new TextDecoder().decode(stdoutChunk.value)).toBe("spawn-out");
    expect(new TextDecoder().decode(stderrChunk.value)).toBe("spawn-err");
    expect(handle.kill).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(0);
  });
});

describe("E2BSandbox shutdown", () => {
  it("runs unmount hooks and kills runtime", async () => {
    const runtime = makeRuntime();
    createSandboxMock.mockResolvedValueOnce(runtime);
    const hookOrder: string[] = [];
    const sandbox = new E2BSandbox(makeSandboxConfig(), {
      preUnmount: async () => {
        hookOrder.push("preUnmount");
      },
      postUnmount: async () => {
        hookOrder.push("postUnmount");
      },
    });
    await sandbox.start();

    await sandbox.shutdown();

    expect(hookOrder).toEqual(["preUnmount", "postUnmount"]);
    expect(runtime.kill).toHaveBeenCalledTimes(1);
    expect(sandbox.status).toBe("stopped");
  });

  it("still runs postUnmount and cleanup when preUnmount fails", async () => {
    const runtime = makeRuntime();
    createSandboxMock.mockResolvedValueOnce(runtime);
    const hookOrder: string[] = [];
    const sandbox = new E2BSandbox(makeSandboxConfig(), {
      preUnmount: async () => {
        hookOrder.push("preUnmount");
        throw new Error("preUnmount failed");
      },
      postUnmount: async () => {
        hookOrder.push("postUnmount");
      },
    });
    await sandbox.start();

    await expect(sandbox.shutdown()).rejects.toThrowError("preUnmount failed");
    expect(hookOrder).toEqual(["preUnmount", "postUnmount"]);
    expect(runtime.kill).toHaveBeenCalledTimes(1);
    expect(sandbox.status).toBe("stopped");
  });
});
