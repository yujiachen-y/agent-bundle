import type { BundleConfig } from "../schema/bundle.js";

export type SandboxConfig = BundleConfig["sandbox"];

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};

export type ExecOptions = {
  timeout?: number;
  cwd?: string;
  onChunk?: (chunk: string) => void;
};

export interface SandboxIO {
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
  file: {
    read(path: string): Promise<string>;
    write(path: string, content: string | Buffer): Promise<void>;
    list(path: string): Promise<FileEntry[]>;
    delete(path: string): Promise<void>;
  };
}

export type SandboxHooks = {
  preMount?: (io: SandboxIO) => Promise<void>;
  postMount?: (io: SandboxIO) => Promise<void>;
  preUnmount?: (io: SandboxIO) => Promise<void>;
  postUnmount?: (io: SandboxIO) => Promise<void>;
};

export type SandboxStatus = "idle" | "starting" | "ready" | "stopping" | "stopped";

export interface Sandbox extends SandboxIO {
  readonly id: string;
  readonly status: SandboxStatus;

  start(): Promise<void>;
  shutdown(): Promise<void>;
}

export type CreateSandbox = (config: SandboxConfig, hooks: SandboxHooks) => Sandbox;
