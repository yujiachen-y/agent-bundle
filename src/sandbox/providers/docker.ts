import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

import type {
  ExecResult,
  FileEntry,
  Sandbox,
  SandboxConfig,
  SandboxHooks,
  SandboxStatus,
  SpawnOptions,
  SpawnedProcess,
} from "../types.js";
import { DEFAULT_DOCKER_SANDBOX_IMAGE } from "../constants.js";
import { quoteShellArg } from "../utils.js";
import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  EXECD_PORT,
  findFreePort,
  READY_POLL_INTERVAL_MS,
  requestCommandRun,
  requestJson,
  spawnExecdProcess,
  toFileEntries,
  waitForHealth,
} from "./execd-client/index.js";
import type { FileListResponse, FileReadResponse } from "./execd-client/index.js";

function isDeleteEndpointMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /HTTP 404 .*\/files\/delete/.test(error.message);
}

function toDockerMemoryUnit(unit: string): string {
  const normalized = unit.toLowerCase();
  if (normalized === "" || normalized === "b") {
    return "";
  }

  const units = new Map<string, string>([
    ["k", "k"],
    ["kb", "k"],
    ["ki", "k"],
    ["kib", "k"],
    ["m", "m"],
    ["mb", "m"],
    ["mi", "m"],
    ["mib", "m"],
    ["g", "g"],
    ["gb", "g"],
    ["gi", "g"],
    ["gib", "g"],
    ["t", "t"],
    ["tb", "t"],
    ["ti", "t"],
    ["tib", "t"],
  ]);
  const mapped = units.get(normalized);
  if (mapped) {
    return mapped;
  }

  throw new Error(`Unsupported sandbox memory unit "${unit}" for Docker provider.`);
}

function normalizeDockerMemory(memory: string): string {
  const compact = memory.trim().replace(/\s+/g, "");
  const match = /^([0-9]+(?:\.[0-9]+)?)([A-Za-z]*)$/.exec(compact);
  if (!match) {
    throw new Error(`Invalid sandbox memory value "${memory}".`);
  }

  const quantity = match[1];
  const unit = toDockerMemoryUnit(match[2] ?? "");
  return `${quantity}${unit}`;
}

function isMissingContainerError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /No such container/i.test(error.message);
}

async function runDocker(args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile("docker", args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout.trim());
        return;
      }

      const details = [stderr, stdout, error.message]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .map((part) => part.trim())
        .join(" | ");
      reject(new Error(`docker ${args.join(" ")} failed: ${details}`));
    });
  });
}

export class DockerSandbox implements Sandbox {
  public readonly id = `docker-${randomUUID()}`;

  private runtimeStatus: SandboxStatus = "idle";
  private execdBaseUrl: string | null = null;
  private readonly containerName: string;

  public readonly file = {
    read: async (path: string): Promise<string> => {
      const response = await requestJson<FileReadResponse>(`${this.getExecdBaseUrl()}/files/read`, {
        method: "POST",
        body: JSON.stringify({ path }),
      });
      return response.content;
    },
    write: async (path: string, content: string | Buffer): Promise<void> => {
      await requestJson(`${this.getExecdBaseUrl()}/files/write`, {
        method: "POST",
        body: JSON.stringify({
          path,
          content: typeof content === "string" ? content : content.toString("utf8"),
        }),
      });
    },
    list: async (path: string): Promise<FileEntry[]> => {
      const queryPath = encodeURIComponent(path);
      const response = await requestJson<FileListResponse>(`${this.getExecdBaseUrl()}/files/list?path=${queryPath}`, {
        method: "GET",
      });
      return toFileEntries(path, response);
    },
    delete: async (path: string): Promise<void> => {
      try {
        await requestJson(`${this.getExecdBaseUrl()}/files/delete`, {
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
    this.containerName = `agent-sandbox-${this.id}`;
  }

  public get status(): SandboxStatus {
    return this.runtimeStatus;
  }

  public async start(): Promise<void> {
    if (this.runtimeStatus === "ready") {
      return;
    }

    this.runtimeStatus = "starting";
    let containerStarted = false;
    try {
      const localPort = await findFreePort();
      const cpu = String(this.config.resources.cpu);
      const memory = normalizeDockerMemory(this.config.resources.memory);
      const image = this.config.docker?.image ?? DEFAULT_DOCKER_SANDBOX_IMAGE;
      await runDocker([
        "run",
        "-d",
        "--name",
        this.containerName,
        "-p",
        `${localPort}:${EXECD_PORT}`,
        "--cpus",
        cpu,
        "--memory",
        memory,
        image,
      ]);
      containerStarted = true;

      this.execdBaseUrl = `http://127.0.0.1:${localPort}`;
      await waitForHealth(
        this.execdBaseUrl,
        DEFAULT_HEALTH_TIMEOUT_MS,
        READY_POLL_INTERVAL_MS,
      );
      await this.runMountHook("preMount");
      await this.runMountHook("postMount");
      this.runtimeStatus = "ready";
    } catch (error) {
      if (containerStarted) {
        await this.removeContainer({ ignoreMissing: true });
      }
      this.execdBaseUrl = null;
      this.runtimeStatus = "stopped";
      throw error;
    }
  }

  public async exec(
    command: string,
    opts?: {
      timeout?: number;
      cwd?: string;
      onChunk?: (chunk: string) => void;
    },
  ): Promise<ExecResult> {
    return await requestCommandRun(
      `${this.getExecdBaseUrl()}/command/run`,
      {
        cmd: command,
        cwd: opts?.cwd,
        timeout: opts?.timeout,
      },
      opts?.onChunk,
    );
  }

  public async spawn(
    command: string,
    args: string[] = [],
    opts?: SpawnOptions,
  ): Promise<SpawnedProcess> {
    return await spawnExecdProcess(this.getExecdBaseUrl(), command, args, opts);
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
      await this.removeContainer({ ignoreMissing: true });
    } catch (error) {
      if (firstError === null) {
        firstError = error;
      }
    }

    this.execdBaseUrl = null;
    this.runtimeStatus = "stopped";
    if (firstError !== null) {
      throw firstError;
    }
  }

  private async removeContainer(options: { ignoreMissing: boolean }): Promise<void> {
    try {
      await runDocker(["rm", "-f", this.containerName]);
    } catch (error) {
      if (options.ignoreMissing && isMissingContainerError(error)) {
        return;
      }
      throw error;
    }
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
      throw new Error("Docker sandbox is not started.");
    }

    return this.execdBaseUrl;
  }
}
