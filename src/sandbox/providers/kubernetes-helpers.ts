import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import type { V1Pod } from "@kubernetes/client-node";

import type { FileEntry } from "../types.js";

export const EXECD_PORT = 3000;
const PORT_FORWARD_START_TIMEOUT_MS = 10_000;

export type PortForwardHandle = {
  stop: () => Promise<void>;
};

export type CommandRunResponse = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type FileReadResponse = {
  content: string;
};

export type FileListResponse = {
  entries: Array<string | { name?: string; path?: string; type?: string }>;
};

export function isNotFoundError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && Reflect.get(error, "statusCode") === 404;
}

export function unwrapPodResponse(response: unknown): V1Pod {
  const body = typeof response === "object" && response !== null
    ? Reflect.get(response, "body")
    : undefined;
  if (typeof body === "object" && body !== null) {
    return body as V1Pod;
  }

  return response as V1Pod;
}

export function isPodReady(pod: V1Pod): boolean {
  const conditions = pod.status?.conditions ?? [];
  return conditions.some((condition) => {
    return condition.type === "Ready" && condition.status === "True";
  });
}

export async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}: ${bodyText}`);
  }

  const payload = bodyText.length > 0 ? JSON.parse(bodyText) : {};
  return payload as T;
}

export async function startPortForward(podName: string, namespace: string): Promise<{
  baseUrl: string;
  handle: PortForwardHandle;
}> {
  const localPort = await findFreePort();
  const child = spawn(
    "kubectl",
    ["port-forward", "-n", namespace, `pod/${podName}`, `${localPort}:${EXECD_PORT}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  await waitForPortForwardStart(child, podName, namespace, localPort);
  return {
    baseUrl: `http://127.0.0.1:${localPort}`,
    handle: {
      stop: async () => {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise<void>((resolve) => {
            child.once("exit", () => resolve());
          }),
          sleep(2_000),
        ]);
      },
    },
  };
}

export function toFileEntries(basePath: string, payload: FileListResponse): FileEntry[] {
  return payload.entries.map((entry) => {
    if (typeof entry === "string") {
      return {
        name: entry,
        path: `${basePath.replace(/\/$/, "")}/${entry}`,
        type: "file",
      };
    }

    const name = entry.name ?? entry.path ?? "unknown";
    const type = entry.type === "directory" || entry.type === "dir" ? "directory" : "file";
    return {
      name,
      path: entry.path ?? `${basePath.replace(/\/$/, "")}/${name}`,
      type,
    };
  });
}

export async function waitForHealth(
  baseUrl: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for execd health at ${baseUrl}.`);
    }

    await sleep(intervalMs);
  }
}

async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to acquire a local port for kubectl port-forward."));
        });
        return;
      }

      const selectedPort = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(selectedPort);
      });
    });
  });
}

async function waitForPortForwardStart(
  child: ReturnType<typeof spawn>,
  podName: string,
  namespace: string,
  localPort: number,
): Promise<void> {
  let startupOutput = "";

  await Promise.race([
    new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        startupOutput += text;
        if (text.includes("Forwarding from")) {
          resolve();
        }
      };
      if (child.stdout) {
        child.stdout.on("data", onData);
      }
      if (child.stderr) {
        child.stderr.on("data", onData);
      }
      child.once("exit", (code) => {
        reject(
          new Error(
            `kubectl port-forward exited early (code=${String(code)}) for pod=${podName} namespace=${namespace} localPort=${String(localPort)} output=${startupOutput.trim()}`,
          ),
        );
      });
    }),
    sleep(PORT_FORWARD_START_TIMEOUT_MS).then(() => {
      throw new Error("Timed out while starting kubectl port-forward.");
    }),
  ]);
}
