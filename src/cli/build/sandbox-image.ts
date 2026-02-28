import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";

type SpawnOptions = {
  stdio: ["ignore", "pipe", "pipe"];
};

type SpawnedProcess = {
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: "close", listener: (code: number | null) => void): SpawnedProcess;
  on(event: "error", listener: (error: Error) => void): SpawnedProcess;
};

export type SpawnLike = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => SpawnedProcess;

export type BuildSandboxImageOptions = {
  bundleDir: string;
  dockerfile: string;
  context?: string;
  buildArgs?: Record<string, string>;
  imageTag: string;
  spawnImpl?: SpawnLike;
  stdout?: Writable;
  stderr?: Writable;
};

export type BuildSandboxImageResult = {
  imageTag: string;
  exitCode: number;
};

export type DockerBuildPaths = {
  dockerfilePath: string;
  contextPath: string;
};

const DEFAULT_STDIO: SpawnOptions["stdio"] = ["ignore", "pipe", "pipe"];

const defaultSpawn: SpawnLike = (command, args, options) => {
  return spawn(command, args, options);
};

function pipeIfPresent(stream: Readable | null, output: Writable): void {
  if (!stream) {
    return;
  }

  stream.on("data", (chunk: Buffer | string) => {
    output.write(chunk);
  });
}

export function resolveDockerBuildPaths(input: {
  bundleDir: string;
  dockerfile: string;
  context?: string;
}): DockerBuildPaths {
  const dockerfilePath = resolve(input.bundleDir, input.dockerfile);
  const contextPath = input.context
    ? resolve(input.bundleDir, input.context)
    : dirname(dockerfilePath);

  return {
    dockerfilePath,
    contextPath,
  };
}

export async function buildSandboxImage(
  options: BuildSandboxImageOptions,
): Promise<BuildSandboxImageResult> {
  const spawnImpl = options.spawnImpl ?? defaultSpawn;
  const output = options.stdout ?? process.stdout;
  const errorOutput = options.stderr ?? process.stderr;
  const paths = resolveDockerBuildPaths({
    bundleDir: options.bundleDir,
    dockerfile: options.dockerfile,
    context: options.context,
  });
  const buildArgs = options.buildArgs
    ? Object.entries(options.buildArgs).flatMap(([key, value]) => ["--build-arg", `${key}=${value}`])
    : [];
  const args = [
    "build",
    "-t",
    options.imageTag,
    "-f",
    paths.dockerfilePath,
    ...buildArgs,
    paths.contextPath,
  ];

  return await new Promise<BuildSandboxImageResult>((resolvePromise, rejectPromise) => {
    const child = spawnImpl("docker", args, { stdio: DEFAULT_STDIO });

    pipeIfPresent(child.stdout, output);
    pipeIfPresent(child.stderr, errorOutput);

    child.on("error", (error) => {
      rejectPromise(new Error(`Failed to start docker build: ${error.message}`));
    });

    child.on("close", (code) => {
      resolvePromise({
        imageTag: options.imageTag,
        exitCode: code ?? 1,
      });
    });
  });
}
