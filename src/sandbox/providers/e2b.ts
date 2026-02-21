import { randomUUID } from "node:crypto";

import { FileType, Sandbox as E2BClientSandbox, type CommandResult } from "e2b";

import type {
  ExecResult,
  FileEntry,
  Sandbox,
  SandboxConfig,
  SandboxHooks,
  SandboxStatus,
} from "../types.js";
import { quoteShellArg } from "../utils.js";

function commandResultFromUnknown(error: unknown): CommandResult | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const stdout = Reflect.get(error, "stdout");
  const stderr = Reflect.get(error, "stderr");
  const exitCode = Reflect.get(error, "exitCode");

  if (
    typeof stdout === "string"
    && typeof stderr === "string"
    && typeof exitCode === "number"
  ) {
    return {
      stdout,
      stderr,
      exitCode,
    };
  }

  return null;
}

function toCreateTimeoutMs(config: SandboxConfig): number {
  return Math.max(1, Math.trunc(config.timeout * 1000));
}

export class E2BSandbox implements Sandbox {
  public readonly id = `e2b-${randomUUID()}`;

  private runtime: E2BClientSandbox | null = null;
  private runtimeStatus: SandboxStatus = "idle";

  public readonly file = {
    read: async (path: string): Promise<string> => {
      const runtime = this.getRuntime();
      return await runtime.files.read(path, { format: "text" });
    },
    write: async (path: string, content: string | Buffer): Promise<void> => {
      const runtime = this.getRuntime();
      const payload = typeof content === "string" ? content : content.toString("utf8");
      await runtime.files.write(path, payload);
    },
    list: async (path: string): Promise<FileEntry[]> => {
      const runtime = this.getRuntime();
      const entries = await runtime.files.list(path);
      return entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type === FileType.DIR ? "directory" : "file",
      }));
    },
    delete: async (path: string): Promise<void> => {
      const runtime = this.getRuntime();
      // E2B SDK currently has no native file delete API; shell delete is the supported path.
      await runtime.commands.run(`rm -rf ${quoteShellArg(path)}`);
    },
  };

  public constructor(
    private readonly config: SandboxConfig,
    private readonly hooks: SandboxHooks = {},
  ) {}

  public get status(): SandboxStatus {
    return this.runtimeStatus;
  }

  public async start(): Promise<void> {
    if (this.runtimeStatus === "ready") {
      return;
    }

    if (this.runtimeStatus === "starting" || this.runtimeStatus === "stopping") {
      throw new Error(`Cannot start E2B sandbox while status is ${this.runtimeStatus}.`);
    }

    this.runtimeStatus = "starting";
    let createdRuntime: E2BClientSandbox | null = null;

    try {
      createdRuntime = await this.createRuntime();
      this.runtime = createdRuntime;
      await this.runMountHook("preMount");
      await this.runMountHook("postMount");
      this.runtimeStatus = "ready";
    } catch (error) {
      await this.killRuntime(createdRuntime ?? this.runtime);
      this.runtime = null;
      this.runtimeStatus = "stopped";
      throw error;
    }
  }

  public async exec(command: string, opts?: {
    timeout?: number;
    cwd?: string;
    onChunk?: (chunk: string) => void;
  }): Promise<ExecResult> {
    const runtime = this.getRuntime();
    try {
      const result = await runtime.commands.run(command, {
        cwd: opts?.cwd,
        timeoutMs: opts?.timeout,
        onStdout: async (chunk) => {
          opts?.onChunk?.(chunk);
        },
        onStderr: async (chunk) => {
          opts?.onChunk?.(chunk);
        },
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } catch (error) {
      const commandResult = commandResultFromUnknown(error);
      if (commandResult === null) {
        throw error;
      }

      return {
        stdout: commandResult.stdout,
        stderr: commandResult.stderr,
        exitCode: commandResult.exitCode,
      };
    }
  }

  public async shutdown(): Promise<void> {
    if (this.runtime === null) {
      this.runtimeStatus = "stopped";
      return;
    }

    this.runtimeStatus = "stopping";
    let firstError: unknown = null;

    const preUnmountHook = this.hooks.preUnmount;
    if (preUnmountHook) {
      try {
        await preUnmountHook(this);
      } catch (error) {
        firstError = error;
      }
    }

    const postUnmountHook = this.hooks.postUnmount;
    if (postUnmountHook) {
      try {
        await postUnmountHook(this);
      } catch (error) {
        if (firstError === null) {
          firstError = error;
        }
      }
    }

    await this.killRuntime(this.runtime);
    this.runtime = null;
    this.runtimeStatus = "stopped";

    if (firstError !== null) {
      throw firstError;
    }
  }

  private getRuntime(): E2BClientSandbox {
    if (this.runtime === null) {
      throw new Error("E2B sandbox is not started.");
    }

    return this.runtime;
  }

  private async createRuntime(): Promise<E2BClientSandbox> {
    const timeoutMs = toCreateTimeoutMs(this.config);
    const template = this.config.e2b?.template;
    if (template && template.length > 0) {
      return await E2BClientSandbox.create(template, { timeoutMs });
    }

    return await E2BClientSandbox.create({ timeoutMs });
  }

  private async runMountHook(hookName: "preMount" | "postMount"): Promise<void> {
    const hook = this.hooks[hookName];
    if (!hook) {
      return;
    }

    await hook(this);
  }

  private async killRuntime(runtime: E2BClientSandbox | null): Promise<void> {
    if (runtime === null) {
      return;
    }

    try {
      await runtime.kill();
    } catch {
      // Best-effort cleanup; status transition continues.
    }
  }
}
