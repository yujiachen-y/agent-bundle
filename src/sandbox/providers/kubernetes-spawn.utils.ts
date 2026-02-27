import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import type { SpawnOptions } from "../types.js";
export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};
type SpawnEvent =
  | { type: "spawn"; pid: number }
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code?: number | null; signal?: string | null }
  | { type: "error"; message: string };
export type ProcessStreams = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  enqueueStdout(data: string): void;
  enqueueStderr(data: string): void;
  closeStreams(): void;
};
const PID_TIMEOUT_MS = 5_000;
export function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  let rejectPromise: ((error: Error) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject as (error: Error) => void;
  });
  return {
    promise,
    resolve: (value) => {
      resolvePromise?.(value);
      resolvePromise = null;
      rejectPromise = null;
    },
    reject: (error) => {
      rejectPromise?.(error);
      resolvePromise = null;
      rejectPromise = null;
    },
  };
}
function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
function parseRawText(raw: WebSocket.RawData): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  if (raw instanceof Buffer) {
    return raw.toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  return Buffer.from(raw).toString("utf8");
}
function parseSpawnEvent(raw: WebSocket.RawData): SpawnEvent {
  const parsed = JSON.parse(parseRawText(raw));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid spawn event payload.");
  }
  const type = Reflect.get(parsed, "type");
  if (type === "spawn" && typeof Reflect.get(parsed, "pid") === "number") {
    return { type, pid: Reflect.get(parsed, "pid") as number };
  }
  if (type === "stdout" && typeof Reflect.get(parsed, "data") === "string") {
    return { type, data: Reflect.get(parsed, "data") as string };
  }
  if (type === "stderr" && typeof Reflect.get(parsed, "data") === "string") {
    return { type, data: Reflect.get(parsed, "data") as string };
  }
  if (type === "exit") {
    const code = Reflect.get(parsed, "code");
    const signal = Reflect.get(parsed, "signal");
    return {
      type,
      code: typeof code === "number" ? code : null,
      signal: typeof signal === "string" ? signal : null,
    };
  }
  if (type === "error" && typeof Reflect.get(parsed, "message") === "string") {
    return { type, message: Reflect.get(parsed, "message") as string };
  }
  throw new Error("Unsupported spawn event payload.");
}
function closeStreamController(
  controller: ReadableStreamDefaultController<Uint8Array> | null,
): void {
  if (controller === null) {
    return;
  }
  try {
    controller.close();
  } catch {
    // Stream may already be closed.
  }
}
export function toWebSocketUrl(
  baseUrl: string,
  command: string,
  args: string[],
  opts?: SpawnOptions,
): string {
  const rootUrl = new URL(baseUrl);
  rootUrl.protocol = rootUrl.protocol === "https:" ? "wss:" : "ws:";
  rootUrl.pathname = "/process/spawn";
  rootUrl.search = "";
  rootUrl.searchParams.set("cmd", command);
  if (opts?.cwd) {
    rootUrl.searchParams.set("cwd", opts.cwd);
  }
  const envArgs = Object.entries(opts?.env ?? {}).map(([key, value]) => `${key}=${value}`);
  const allArgs = envArgs.length > 0
    ? [...envArgs, command, ...args]
    : args;
  if (envArgs.length > 0) {
    rootUrl.searchParams.set("cmd", "env");
  }
  allArgs.forEach((arg) => {
    rootUrl.searchParams.append("args", arg);
  });
  return rootUrl.toString();
}
export async function waitForPid(pid: Promise<number>): Promise<number> {
  return await Promise.race([
    pid,
    sleep(PID_TIMEOUT_MS).then(() => {
      throw new Error(`Timed out waiting for spawned process pid after ${PID_TIMEOUT_MS}ms.`);
    }),
  ]);
}
export async function sendJson(
  socket: WebSocket,
  payload: unknown,
  options?: { ignoreClosed?: boolean },
): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN) {
    if (options?.ignoreClosed) {
      return;
    }
    throw new Error(`Spawn socket is not open (readyState=${socket.readyState}).`);
  }
  await new Promise<void>((resolve, reject) => {
    socket.send(JSON.stringify(payload), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
function toExitCode(event: Extract<SpawnEvent, { type: "exit" }>): number {
  if (typeof event.code === "number") {
    return event.code < 0 ? 1 : event.code;
  }
  if (typeof event.signal === "string" && event.signal.length > 0) {
    return 1;
  }
  return 0;
}
export function createProcessStreams(): ProcessStreams {
  let stdoutController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let stderrController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const closeStreams = (): void => {
    closeStreamController(stdoutController);
    closeStreamController(stderrController);
    stdoutController = null;
    stderrController = null;
  };
  return {
    stdout: new ReadableStream<Uint8Array>({
      start(controller) {
        stdoutController = controller;
      },
    }),
    stderr: new ReadableStream<Uint8Array>({
      start(controller) {
        stderrController = controller;
      },
    }),
    enqueueStdout: (data) => {
      stdoutController?.enqueue(toBytes(data));
    },
    enqueueStderr: (data) => {
      stderrController?.enqueue(toBytes(data));
    },
    closeStreams,
  };
}
export function bindSocketEvents(input: {
  socket: WebSocket;
  pidDeferred: Deferred<number>;
  exitedDeferred: Deferred<number>;
  streams: ProcessStreams;
  state: { hasExited: boolean };
}): void {
  const { socket, pidDeferred, exitedDeferred, streams, state } = input;
  socket.on("message", (raw) => {
    try {
      const event = parseSpawnEvent(raw);
      if (event.type === "spawn") {
        pidDeferred.resolve(event.pid);
        return;
      }
      if (event.type === "stdout") {
        streams.enqueueStdout(event.data);
        return;
      }
      if (event.type === "stderr") {
        streams.enqueueStderr(event.data);
        return;
      }
      if (event.type === "exit") {
        state.hasExited = true;
        exitedDeferred.resolve(toExitCode(event));
        streams.closeStreams();
        return;
      }
      state.hasExited = true;
      exitedDeferred.reject(new Error(event.message));
      streams.closeStreams();
    } catch (error) {
      state.hasExited = true;
      exitedDeferred.reject(new Error(error instanceof Error ? error.message : String(error)));
      streams.closeStreams();
    }
  });
  socket.on("error", (error) => {
    if (state.hasExited) {
      return;
    }
    state.hasExited = true;
    pidDeferred.reject(error);
    exitedDeferred.reject(error);
    streams.closeStreams();
  });
  socket.on("close", () => {
    if (state.hasExited) {
      return;
    }
    state.hasExited = true;
    const error = new Error("Spawn websocket closed before process exit.");
    pidDeferred.reject(error);
    exitedDeferred.reject(error);
    streams.closeStreams();
  });
}
export function createStdinStream(socket: WebSocket): WritableStream<Uint8Array> {
  const stdinDecoder = new TextDecoder();
  return new WritableStream<Uint8Array>({
    write: async (chunk) => {
      const text = stdinDecoder.decode(chunk, { stream: true });
      if (text.length > 0) {
        await sendJson(socket, { type: "stdin", data: text });
      }
    },
    close: async () => {
      const trailing = stdinDecoder.decode();
      if (trailing.length > 0) {
        await sendJson(socket, { type: "stdin", data: trailing });
      }
      await sendJson(socket, { type: "stdin-close" }, { ignoreClosed: true });
    },
    abort: async () => {
      await sendJson(socket, { type: "kill", signal: "SIGTERM" }, { ignoreClosed: true });
    },
  });
}
export function toExitedPromise(
  socket: WebSocket,
  exited: Promise<number>,
  closeStreams: () => void,
): Promise<number> {
  return exited.finally(() => {
    closeStreams();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  });
}
