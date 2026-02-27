import type { AddressInfo } from "node:net";

import { afterEach, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { spawnKubernetesProcess } from "./kubernetes-spawn.js";

type JsonMessage = Record<string, unknown>;

const openServers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(async (server) => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }),
  );
});

function toBaseUrl(server: WebSocketServer): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address.");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function waitForListening(server: WebSocketServer): Promise<void> {
  if (server.address()) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
}

function decode(raw: import("ws").RawData): JsonMessage {
  if (typeof raw === "string") {
    return JSON.parse(raw) as JsonMessage;
  }

  if (Array.isArray(raw)) {
    return JSON.parse(Buffer.concat(raw).toString("utf8")) as JsonMessage;
  }

  if (raw instanceof Buffer) {
    return JSON.parse(raw.toString("utf8")) as JsonMessage;
  }

  if (raw instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(raw).toString("utf8")) as JsonMessage;
  }

  return JSON.parse(Buffer.from(raw).toString("utf8")) as JsonMessage;
}

async function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

it("spawns via websocket and relays stdin/stdout/stderr/exit", async () => {
  const serverMessages: JsonMessage[] = [];
  const server = new WebSocketServer({ port: 0 });
  openServers.push(server);

  server.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    expect(url.pathname).toBe("/process/spawn");
    expect(url.searchParams.get("cmd")).toBe("python3");
    expect(url.searchParams.get("cwd")).toBe("/workspace");
    expect(url.searchParams.getAll("args")).toEqual(["echo.py"]);

    socket.send(JSON.stringify({ type: "spawn", pid: 321 }));
    socket.on("message", (raw) => {
      const parsed = decode(raw);
      serverMessages.push(parsed);

      if (parsed.type === "stdin-close") {
        socket.send(JSON.stringify({ type: "stdout", data: "pong" }));
        socket.send(JSON.stringify({ type: "stderr", data: "warn" }));
        socket.send(JSON.stringify({ type: "exit", code: 0, signal: null }));
      }
    });
  });

  await waitForListening(server);
  const process = await spawnKubernetesProcess(toBaseUrl(server), "python3", ["echo.py"], {
    cwd: "/workspace",
  });
  expect(process.pid).toBe(321);

  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode("ping\n"));
  await writer.close();
  writer.releaseLock();

  const [stdout, stderr, exitCode] = await Promise.all([
    readStreamText(process.stdout),
    readStreamText(process.stderr),
    process.exited,
  ]);

  expect(serverMessages).toContainEqual({ type: "stdin", data: "ping\n" });
  expect(serverMessages).toContainEqual({ type: "stdin-close" });
  expect(stdout).toBe("pong");
  expect(stderr).toBe("warn");
  expect(exitCode).toBe(0);
});

it("encodes env as env command args and forwards kill signals", async () => {
  const serverMessages: JsonMessage[] = [];
  const server = new WebSocketServer({ port: 0 });
  openServers.push(server);

  server.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    expect(url.searchParams.get("cmd")).toBe("env");
    expect(url.searchParams.getAll("args")).toEqual([
      "A=1",
      "B=2",
      "node",
      "server.js",
    ]);

    socket.send(JSON.stringify({ type: "spawn", pid: 22 }));
    socket.on("message", (raw) => {
      const parsed = decode(raw);
      serverMessages.push(parsed);
      if (parsed.type === "kill") {
        socket.send(JSON.stringify({ type: "exit", code: null, signal: "SIGKILL" }));
      }
    });
  });

  await waitForListening(server);
  const process = await spawnKubernetesProcess(toBaseUrl(server), "node", ["server.js"], {
    env: { A: "1", B: "2" },
  });
  await process.kill("SIGKILL");

  const exitCode = await process.exited;
  expect(serverMessages).toContainEqual({ type: "kill", signal: "SIGKILL" });
  expect(exitCode).toBe(1);
});
