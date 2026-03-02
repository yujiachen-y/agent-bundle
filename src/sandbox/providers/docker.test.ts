import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SandboxConfig } from "../types.js";

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;
type ExecFileMock = ReturnType<typeof vi.fn>;

const execFileMock: ExecFileMock = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

const { DockerSandbox } = await import("./docker.js");

function makeSandboxConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    provider: "docker",
    timeout: 10,
    resources: {
      cpu: 2,
      memory: "512MB",
    },
    ...overrides,
  };
}

function setupExecFileSuccess(): void {
  execFileMock.mockImplementation((
    _command: string,
    _args: string[],
    _options: object,
    callback: ExecFileCallback,
  ) => {
    callback(null, "", "");
    return {} as never;
  });
}

beforeEach(() => {
  execFileMock.mockReset();
  setupExecFileSuccess();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("DockerSandbox start", () => {
  it("runs docker start flow, waits health, and runs mount hooks", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    const hookOrder: string[] = [];
    const sandbox = new DockerSandbox(makeSandboxConfig(), {
      preMount: async () => {
        hookOrder.push("preMount");
      },
      postMount: async () => {
        hookOrder.push("postMount");
      },
    });

    await sandbox.start();

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const dockerRunArgs = execFileMock.mock.calls[0]?.[1] as string[];
    expect(dockerRunArgs).toContain("run");
    expect(dockerRunArgs).toContain("--cpus");
    expect(dockerRunArgs).toContain("2");
    expect(dockerRunArgs).toContain("--memory");
    expect(dockerRunArgs).toContain("512m");
    expect(hookOrder).toEqual(["preMount", "postMount"]);
    expect(sandbox.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/health$/));
  });

  it("normalizes GiB memory value to docker-compatible unit", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    const sandbox = new DockerSandbox(
      makeSandboxConfig({
        resources: {
          cpu: 2,
          memory: "1GiB",
        },
      }),
    );

    await sandbox.start();

    const dockerRunArgs = execFileMock.mock.calls[0]?.[1] as string[];
    const memoryFlagIndex = dockerRunArgs.indexOf("--memory");
    expect(memoryFlagIndex).toBeGreaterThan(-1);
    expect(dockerRunArgs[memoryFlagIndex + 1]).toBe("1g");
  });

  it("cleans up container when start fails after run", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    const sandbox = new DockerSandbox(makeSandboxConfig(), {
      preMount: async () => {
        throw new Error("preMount failed");
      },
    });

    await expect(sandbox.start()).rejects.toThrowError("preMount failed");
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["rm", "-f"]));
    expect(sandbox.status).toBe("stopped");
  });
});

describe("DockerSandbox exec and files", () => {
  it("delegates exec and file operations to execd endpoints", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response('{"status":"ok"}', { status: 200 });
      }
      if (url.endsWith("/command/run")) {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            stdout: "hello\n",
            stderr: "",
            exitCode: 0,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/files/read")) {
        return new Response(JSON.stringify({ content: "from-file" }), { status: 200 });
      }
      if (url.endsWith("/files/write")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/files/list")) {
        return new Response(
          JSON.stringify({
            entries: [
              { name: "skills", path: "/skills", type: "directory" },
              "SKILL.md",
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/files/delete")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const sandbox = new DockerSandbox(makeSandboxConfig());
    await sandbox.start();

    const chunks: string[] = [];
    const execResult = await sandbox.exec("echo hello", {
      cwd: "/workspace",
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });
    const fileContent = await sandbox.file.read("/workspace/input.txt");
    await sandbox.file.write("/workspace/output.txt", "done");
    const listed = await sandbox.file.list("/skills");
    await sandbox.file.delete("/workspace/output.txt");

    expect(execResult).toEqual({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
    });
    expect(chunks).toEqual(["hello\n"]);
    expect(fileContent).toBe("from-file");
    expect(listed).toEqual([
      { name: "skills", path: "/skills", type: "directory" },
      { name: "SKILL.md", path: "/skills/SKILL.md", type: "file" },
    ]);
  });
});

describe("DockerSandbox file delete fallback", () => {
  it("falls back to shell delete when /files/delete endpoint is missing", async () => {
    const requestLog: Array<{ url: string; body?: string }> = [];
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      requestLog.push({
        url,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.endsWith("/health")) {
        return new Response('{"status":"ok"}', { status: 200 });
      }
      if (url.endsWith("/files/delete")) {
        return new Response('{"error":"not found"}', { status: 404 });
      }
      if (url.endsWith("/command/run")) {
        return new Response(
          JSON.stringify({
            stdout: "",
            stderr: "",
            exitCode: 0,
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const sandbox = new DockerSandbox(makeSandboxConfig());
    await sandbox.start();
    await sandbox.file.delete("/workspace/fallback-delete.txt");

    expect(requestLog.some((entry) => entry.url.endsWith("/files/delete"))).toBe(true);
    expect(
      requestLog.some((entry) => {
        if (!entry.url.endsWith("/command/run") || !entry.body) {
          return false;
        }

        return entry.body.includes("rm -rf '/workspace/fallback-delete.txt'");
      }),
    ).toBe(true);
  });
});

describe("DockerSandbox shutdown", () => {
  it("runs unmount hooks and removes container", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    const hookOrder: string[] = [];
    const sandbox = new DockerSandbox(makeSandboxConfig(), {
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
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["rm", "-f"]));
    expect(sandbox.status).toBe("stopped");
  });

  it("ignores missing container errors during shutdown cleanup", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    execFileMock.mockImplementation((
      _command: string,
      args: string[],
      _options: object,
      callback: ExecFileCallback,
    ) => {
      if (args[0] === "rm") {
        callback(new Error("No such container"), "", "No such container");
        return {} as never;
      }

      callback(null, "", "");
      return {} as never;
    });
    const sandbox = new DockerSandbox(makeSandboxConfig());
    await sandbox.start();

    await expect(sandbox.shutdown()).resolves.toBeUndefined();
    expect(sandbox.status).toBe("stopped");
  });
});

describe("DockerSandbox validation errors", () => {
  it("rejects unsupported Docker memory units", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    execFileMock.mockImplementation((
      _command: string,
      args: string[],
      _options: object,
      callback: ExecFileCallback,
    ) => {
      if (args[0] === "rm") {
        callback(new Error("No such container"), "", "No such container");
        return {} as never;
      }

      callback(null, "", "");
      return {} as never;
    });
    const sandbox = new DockerSandbox(
      makeSandboxConfig({
        resources: {
          cpu: 2,
          memory: "10XB",
        },
      }),
    );

    await expect(sandbox.start()).rejects.toThrowError("Unsupported sandbox memory unit");
    expect(sandbox.status).toBe("stopped");
  });
});
