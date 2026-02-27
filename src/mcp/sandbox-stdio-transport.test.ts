import { describe, expect, it, vi } from "vitest";

import type { SandboxIO, SpawnedProcess } from "../sandbox/types.js";
import { SandboxStdioTransport } from "./sandbox-stdio-transport.js";

type MockProcessControls = {
  process: SpawnedProcess;
  stdinWrites: string[];
  emitStdout(text: string): void;
  emitStderr(text: string): void;
  resolveExit(code: number): void;
};

function createMockProcess(): MockProcessControls {
  let stdoutController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let stderrController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      stdoutController = controller;
    },
  });
  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      stderrController = controller;
    },
  });

  let resolveExitPromise: ((code: number) => void) | null = null;
  const exited = new Promise<number>((resolve) => {
    resolveExitPromise = resolve;
  });

  const decoder = new TextDecoder();
  const stdinWrites: string[] = [];
  const stdin = new WritableStream<Uint8Array>({
    write: async (chunk) => {
      const text = decoder.decode(chunk, { stream: true });
      if (text.length > 0) {
        stdinWrites.push(text);
      }
    },
    close: async () => {
      const trailing = decoder.decode();
      if (trailing.length > 0) {
        stdinWrites.push(trailing);
      }
    },
  });

  return {
    process: {
      pid: 17,
      stdin,
      stdout,
      stderr,
      exited,
      kill: async () => undefined,
    },
    stdinWrites,
    emitStdout: (text) => {
      stdoutController?.enqueue(new TextEncoder().encode(text));
    },
    emitStderr: (text) => {
      stderrController?.enqueue(new TextEncoder().encode(text));
    },
    resolveExit: (code) => {
      resolveExitPromise?.(code);
      resolveExitPromise = null;
      try {
        stdoutController?.close();
      } catch {
        // already closed
      }
      try {
        stderrController?.close();
      } catch {
        // already closed
      }
      stdoutController = null;
      stderrController = null;
    },
  };
}

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SandboxStdioTransport", () => {
  it("spawns via sandbox, sends JSON-RPC lines, and emits parsed messages", async () => {
    const controls = createMockProcess();
    const sandbox: SandboxIO = {
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      spawn: vi.fn(async () => controls.process),
      file: {
        read: async () => "",
        write: async () => undefined,
        list: async () => [],
        delete: async () => undefined,
      },
    };

    const transport = new SandboxStdioTransport({
      sandbox,
      command: "node",
      args: ["server.js"],
      env: { NODE_ENV: "test" },
      cwd: "/workspace",
    });
    const onmessage = vi.fn();
    const onerror = vi.fn();
    const onclose = vi.fn();
    transport.onmessage = onmessage;
    transport.onerror = onerror;
    transport.onclose = onclose;

    await transport.start();
    expect(sandbox.spawn).toHaveBeenCalledWith(
      "node",
      ["server.js"],
      {
        cwd: "/workspace",
        env: { NODE_ENV: "test" },
      },
    );

    await transport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { ok: true },
    });
    expect(controls.stdinWrites.join("")).toContain("\"method\":\"ping\"");
    expect(controls.stdinWrites.join("")).toContain("\n");

    controls.emitStdout("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n");
    controls.emitStderr("warning\n");
    await flushTasks();

    expect(onmessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
    expect(onerror).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("warning"),
    }));

    controls.resolveExit(0);
    await flushTasks();
    expect(onclose).toHaveBeenCalledTimes(1);
    await transport.close();
  });

  it("reports non-zero exits", async () => {
    const controls = createMockProcess();
    const sandbox: SandboxIO = {
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      spawn: vi.fn(async () => controls.process),
      file: {
        read: async () => "",
        write: async () => undefined,
        list: async () => [],
        delete: async () => undefined,
      },
    };

    const transport = new SandboxStdioTransport({
      sandbox,
      command: "node",
    });
    const onerror = vi.fn();
    transport.onerror = onerror;

    await transport.start();
    controls.resolveExit(3);
    await flushTasks();

    expect(onerror).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("exited with code 3"),
    }));
  });
});
