import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SandboxConfig } from "../types.js";

type CoreApiMock = {
  createNamespacedPod: ReturnType<typeof vi.fn>;
  readNamespacedPod: ReturnType<typeof vi.fn>;
  deleteNamespacedPod: ReturnType<typeof vi.fn>;
};

let coreApiMock: CoreApiMock;
const loadFromDefaultMock = vi.fn();
const loadFromFileMock = vi.fn();
const makeApiClientMock = vi.fn(() => coreApiMock);
const fetchMock = vi.fn<typeof fetch>();

vi.mock("@kubernetes/client-node", () => ({
  KubeConfig: class {
    public loadFromDefault = loadFromDefaultMock;
    public loadFromFile = loadFromFileMock;
    public makeApiClient = makeApiClientMock;
  },
  CoreV1Api: class {},
}));

const { K8sSandbox } = await import("./kubernetes.js");

function makeSandboxConfig(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    provider: "kubernetes",
    timeout: 10,
    resources: {
      cpu: 2,
      memory: "512MB",
    },
    ...overrides,
  };
}

beforeEach(() => {
  coreApiMock = {
    createNamespacedPod: vi.fn(async () => undefined),
    readNamespacedPod: vi.fn(async () => ({
      status: {
        phase: "Running",
        podIP: "10.0.0.9",
        conditions: [{ type: "Ready", status: "True" }],
      },
    })),
    deleteNamespacedPod: vi.fn(async () => undefined),
  };
  makeApiClientMock.mockClear();
  loadFromDefaultMock.mockClear();
  loadFromFileMock.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("K8sSandbox start", () => {
  it("creates pod, waits readiness, checks health, and runs mount hooks", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    const hookOrder: string[] = [];
    const sandbox = new K8sSandbox(makeSandboxConfig(), {
      preMount: async () => {
        hookOrder.push("preMount");
      },
      postMount: async () => {
        hookOrder.push("postMount");
      },
    });

    await sandbox.start();

    expect(loadFromDefaultMock).toHaveBeenCalledTimes(1);
    expect(makeApiClientMock).toHaveBeenCalledTimes(1);
    expect(coreApiMock.createNamespacedPod).toHaveBeenCalledTimes(1);
    expect(coreApiMock.readNamespacedPod).toHaveBeenCalledTimes(1);
    expect(hookOrder).toEqual(["preMount", "postMount"]);
    expect(sandbox.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledWith("http://10.0.0.9:3000/health");
  });

  it("builds pod spec with labels and resource limits", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    const sandbox = new K8sSandbox(
      makeSandboxConfig({
        kubernetes: {
          namespace: "agent-runtime",
          image: "registry.example.com/agent-sandbox:latest",
          nodeSelector: { disk: "ssd" },
        },
      }),
    );

    await sandbox.start();

    expect(coreApiMock.createNamespacedPod).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "agent-runtime",
        body: expect.objectContaining({
          metadata: expect.objectContaining({
            labels: expect.objectContaining({
              app: "agent-sandbox",
            }),
          }),
          spec: expect.objectContaining({
            nodeSelector: { disk: "ssd" },
            containers: [
              expect.objectContaining({
                image: "registry.example.com/agent-sandbox:latest",
                resources: {
                  requests: { cpu: "2", memory: "512MB" },
                  limits: { cpu: "2", memory: "512MB" },
                },
              }),
            ],
          }),
        }),
      }),
    );
  });

  it("loads kubeconfig from file when kubernetes.kubeconfig is set", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    const sandbox = new K8sSandbox(
      makeSandboxConfig({
        kubernetes: {
          kubeconfig: "/custom/kubeconfig.yaml",
        },
      }),
    );

    await sandbox.start();

    expect(loadFromFileMock).toHaveBeenCalledWith("/custom/kubeconfig.yaml");
    expect(loadFromDefaultMock).not.toHaveBeenCalled();
  });

  it("cleans up pod when start fails after pod creation", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    const sandbox = new K8sSandbox(makeSandboxConfig(), {
      preMount: async () => {
        throw new Error("preMount failed");
      },
    });

    await expect(sandbox.start()).rejects.toThrowError("preMount failed");
    expect(coreApiMock.deleteNamespacedPod).toHaveBeenCalledTimes(1);
    expect(sandbox.status).toBe("stopped");
  });
});

describe("K8sSandbox exec and files (json)", () => {
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

    const sandbox = new K8sSandbox(makeSandboxConfig());
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
describe("K8sSandbox exec and files (sse)", () => {
  it("streams command output chunks when /command/run responds with SSE", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response('{"status":"ok"}', { status: 200 });
      }
      if (url.endsWith("/command/run")) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("event: stdout\ndata: hello\n\n"));
            controller.enqueue(encoder.encode("event: stderr\ndata: warn\n\n"));
            controller.enqueue(
              encoder.encode(
                "event: result\ndata: {\"stdout\":\"hello\\n\",\"stderr\":\"warn\\n\",\"exitCode\":0}\n\n",
              ),
            );
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        });
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    const sandbox = new K8sSandbox(makeSandboxConfig());
    await sandbox.start();

    const chunks: string[] = [];
    const execResult = await sandbox.exec("echo hello", {
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });

    expect(chunks).toEqual(["hello", "warn"]);
    expect(execResult).toEqual({
      stdout: "hello\n",
      stderr: "warn\n",
      exitCode: 0,
    });
  });
});

describe("K8sSandbox file delete fallback", () => {
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

    const sandbox = new K8sSandbox(makeSandboxConfig());
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

describe("K8sSandbox shutdown", () => {
  it("runs unmount hooks and deletes pod", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    const hookOrder: string[] = [];
    const sandbox = new K8sSandbox(makeSandboxConfig(), {
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
    expect(coreApiMock.deleteNamespacedPod).toHaveBeenCalledTimes(1);
    expect(sandbox.status).toBe("stopped");
  });
});
