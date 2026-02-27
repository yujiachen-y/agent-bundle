import WebSocket from "ws";

import type { SpawnOptions, SpawnedProcess } from "../types.js";
import {
  bindSocketEvents,
  createDeferred,
  createProcessStreams,
  createStdinStream,
  sendJson,
  toExitedPromise,
  toWebSocketUrl,
  waitForPid,
} from "./kubernetes-spawn.utils.js";

export async function spawnKubernetesProcess(
  baseUrl: string,
  command: string,
  args: string[] = [],
  opts?: SpawnOptions,
): Promise<SpawnedProcess> {
  const socket = new WebSocket(toWebSocketUrl(baseUrl, command, args, opts));
  const pidDeferred = createDeferred<number>();
  const exitedDeferred = createDeferred<number>();
  // Keep deferred rejection observed even if spawn fails before returning a process.
  void exitedDeferred.promise.catch(() => undefined);
  const streams = createProcessStreams();

  bindSocketEvents({
    socket,
    pidDeferred,
    exitedDeferred,
    streams,
    state: { hasExited: false },
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", (error) => reject(error));
  });

  try {
    const pid = await waitForPid(pidDeferred.promise);
    return {
      pid,
      stdin: createStdinStream(socket),
      stdout: streams.stdout,
      stderr: streams.stderr,
      exited: toExitedPromise(socket, exitedDeferred.promise, streams.closeStreams),
      kill: async (signal?: string) => {
        await sendJson(
          socket,
          { type: "kill", signal: signal ?? "SIGTERM" },
          { ignoreClosed: true },
        );
      },
    };
  } catch (error) {
    streams.closeStreams();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
    throw error;
  }
}
