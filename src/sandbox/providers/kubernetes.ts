import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { CoreV1Api, type V1Pod } from "@kubernetes/client-node";

import type {
  ExecResult,
  FileEntry,
  Sandbox,
  SandboxConfig,
  SandboxHooks,
  SandboxStatus,
} from "../types.js";
import { quoteShellArg } from "../utils.js";
import { requestCommandRun } from "./kubernetes-command-run.js";
import { createCoreApi } from "./kubernetes-kubeconfig.js";
import {
  DIRECT_POD_HEALTH_TIMEOUT_MS,
  DEFAULT_HEALTH_TIMEOUT_MS,
  READY_POLL_INTERVAL_MS,
} from "./kubernetes.constants.js";
import type { FileListResponse, FileReadResponse, PortForwardHandle } from "./kubernetes-helpers.js";
import {
  EXECD_PORT,
  isNotFoundError,
  isPodReady,
  requestJson,
  startPortForward,
  toFileEntries,
  unwrapPodResponse,
  waitForHealth,
} from "./kubernetes-helpers.js";

function isDeleteEndpointMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /HTTP 404 .*\/files\/delete/.test(error.message);
}

export class K8sSandbox implements Sandbox {
  public readonly id = `k8s-${randomUUID()}`;

  private readonly coreApi: CoreV1Api;
  private readonly namespace: string;
  private readonly podName: string;
  private readonly kubectlKubeconfigPath: string | null;
  private temporaryKubeconfigPath: string | null;
  private runtimeStatus: SandboxStatus = "idle";
  private execdBaseUrl: string | null = null;
  private portForward: PortForwardHandle | null = null;

  public readonly file = {
    read: async (path: string): Promise<string> => {
      const baseUrl = this.getExecdBaseUrl();
      const response = await requestJson<FileReadResponse>(`${baseUrl}/files/read`, {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      return response.content;
    },
    write: async (path: string, content: string | Buffer): Promise<void> => {
      const baseUrl = this.getExecdBaseUrl();
      await requestJson(`${baseUrl}/files/write`, {
        method: "POST",
        body: JSON.stringify({
          path,
          content: typeof content === "string" ? content : content.toString("utf8"),
        }),
      });
    },
    list: async (path: string): Promise<FileEntry[]> => {
      const baseUrl = this.getExecdBaseUrl();
      const queryPath = encodeURIComponent(path);
      const response = await requestJson<FileListResponse>(`${baseUrl}/files/list?path=${queryPath}`, {
        method: "GET",
      });
      return toFileEntries(path, response);
    },
    delete: async (path: string): Promise<void> => {
      const baseUrl = this.getExecdBaseUrl();
      try {
        await requestJson(`${baseUrl}/files/delete`, {
          method: "POST",
          body: JSON.stringify({ path }),
        });
      } catch (error) {
        if (!isDeleteEndpointMissingError(error)) {
          throw error;
        }

        await this.exec(`rm -rf ${quoteShellArg(path)}`);
      }
    },
  };

  public constructor(
    private readonly config: SandboxConfig,
    private readonly hooks: SandboxHooks = {},
  ) {
    const coreApiContext = createCoreApi(this.config.kubernetes?.kubeconfig);
    this.coreApi = coreApiContext.coreApi;
    this.namespace = this.config.kubernetes?.namespace ?? "default";
    this.podName = `agent-sandbox-${this.id}`;
    this.kubectlKubeconfigPath = coreApiContext.kubectlKubeconfigPath;
    this.temporaryKubeconfigPath = coreApiContext.temporaryKubeconfigPath;
  }

  public get status(): SandboxStatus {
    return this.runtimeStatus;
  }

  public async start(): Promise<void> {
    if (this.runtimeStatus === "ready") {
      return;
    }

    this.runtimeStatus = "starting";
    try {
      await this.coreApi.createNamespacedPod({
        namespace: this.namespace,
        body: this.buildPodSpec(),
      });
      const readyPod = await this.waitForPodReady();
      await this.connectExecd(readyPod);
      await this.runMountHook("preMount");
      await this.runMountHook("postMount");
      this.runtimeStatus = "ready";
    } catch (error) {
      await this.cleanupInfrastructure();
      this.runtimeStatus = "stopped";
      throw error;
    }
  }

  public async exec(command: string, opts?: {
    timeout?: number;
    cwd?: string;
    onChunk?: (chunk: string) => void;
  }): Promise<ExecResult> {
    const baseUrl = this.getExecdBaseUrl();
    return await requestCommandRun(
      `${baseUrl}/command/run`,
      {
        cmd: command,
        cwd: opts?.cwd,
        timeout: opts?.timeout,
      },
      opts?.onChunk,
    );
  }

  public async shutdown(): Promise<void> {
    this.runtimeStatus = "stopping";
    let firstError: unknown = null;

    await this.runUnmountHook("preUnmount", (error) => {
      firstError = error;
    });
    await this.runUnmountHook("postUnmount", (error) => {
      if (firstError === null) {
        firstError = error;
      }
    });
    try {
      await this.cleanupInfrastructure();
    } catch (error) {
      if (firstError === null) {
        firstError = error;
      }
    }

    this.runtimeStatus = "stopped";
    if (firstError !== null) {
      throw firstError;
    }
  }

  private buildPodSpec(): V1Pod {
    const cpu = String(this.config.resources.cpu);
    const memory = this.config.resources.memory;
    return {
      metadata: {
        name: this.podName,
        labels: {
          app: "agent-sandbox",
          "sandbox-id": this.id,
        },
      },
      spec: {
        restartPolicy: "Never",
        nodeSelector: this.config.kubernetes?.nodeSelector,
        containers: [
          {
            name: "execd",
            image: this.config.kubernetes?.image ?? "agent-bundle/execd:latest",
            imagePullPolicy: "IfNotPresent",
            ports: [{ containerPort: EXECD_PORT, name: "http" }],
            resources: {
              requests: { cpu, memory },
              limits: { cpu, memory },
            },
          },
        ],
      },
    };
  }

  private async waitForPodReady(): Promise<V1Pod> {
    const timeoutMs = Math.max(1, Math.trunc(this.config.timeout * 1000));
    const startAt = Date.now();
    for (;;) {
      const response = await this.coreApi.readNamespacedPod({
        namespace: this.namespace,
        name: this.podName,
      });
      const pod = unwrapPodResponse(response);
      if (isPodReady(pod)) {
        return pod;
      }
      if (pod.status?.phase === "Failed") {
        throw new Error(`Pod ${this.podName} entered Failed phase.`);
      }
      if (Date.now() - startAt >= timeoutMs) {
        throw new Error(`Timed out waiting for pod ${this.podName} readiness.`);
      }

      await sleep(READY_POLL_INTERVAL_MS);
    }
  }

  private async connectExecd(pod: V1Pod): Promise<void> {
    const podIp = pod.status?.podIP?.trim() ?? "";
    if (podIp.length > 0) {
      const directBaseUrl = `http://${podIp}:${EXECD_PORT}`;
      try {
        await waitForHealth(
          directBaseUrl,
          DIRECT_POD_HEALTH_TIMEOUT_MS,
          READY_POLL_INTERVAL_MS,
        );
        this.execdBaseUrl = directBaseUrl;
        return;
      } catch {
        // Fall back to port-forward on clusters where pod IP is not routable from host.
      }
    }

    const forwarded = await startPortForward(
      this.podName,
      this.namespace,
      this.kubectlKubeconfigPath ?? undefined,
    );
    this.execdBaseUrl = forwarded.baseUrl;
    this.portForward = forwarded.handle;

    await waitForHealth(
      this.execdBaseUrl,
      DEFAULT_HEALTH_TIMEOUT_MS,
      READY_POLL_INTERVAL_MS,
    );
  }

  private async runMountHook(hookName: "preMount" | "postMount"): Promise<void> {
    const hook = this.hooks[hookName];
    if (hook) {
      await hook(this);
    }
  }

  private async runUnmountHook(
    hookName: "preUnmount" | "postUnmount",
    onError: (error: unknown) => void,
  ): Promise<void> {
    const hook = this.hooks[hookName];
    if (!hook) {
      return;
    }

    try {
      await hook(this);
    } catch (error) {
      onError(error);
    }
  }

  private getExecdBaseUrl(): string {
    if (this.execdBaseUrl === null) {
      throw new Error("Kubernetes sandbox is not started.");
    }

    return this.execdBaseUrl;
  }

  private async cleanupInfrastructure(): Promise<void> {
    if (this.portForward) {
      await this.portForward.stop();
      this.portForward = null;
    }

    try {
      await this.coreApi.deleteNamespacedPod({
        namespace: this.namespace,
        name: this.podName,
      });
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    } finally {
      this.execdBaseUrl = null;
      if (this.temporaryKubeconfigPath) {
        rmSync(this.temporaryKubeconfigPath, { force: true });
        this.temporaryKubeconfigPath = null;
      }
    }
  }
}
