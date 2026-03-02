import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import type { V1Pod } from "@kubernetes/client-node";

import { EXECD_PORT, findFreePort } from "./execd-client/request.js";

const PORT_FORWARD_START_TIMEOUT_MS = 10_000;

export type PortForwardHandle = {
  stop: () => Promise<void>;
};

export function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  return Reflect.get(error, "statusCode") === 404
    || Reflect.get(error, "code") === 404;
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

export async function startPortForward(
  podName: string,
  namespace: string,
  kubeconfigPath?: string,
): Promise<{
  baseUrl: string;
  handle: PortForwardHandle;
}> {
  const localPort = await findFreePort();
  const args = ["port-forward", "-n", namespace];
  if (kubeconfigPath) {
    args.push("--kubeconfig", kubeconfigPath);
  }
  args.push(`pod/${podName}`, `${localPort}:${EXECD_PORT}`);
  const child = spawn(
    "kubectl",
    args,
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
