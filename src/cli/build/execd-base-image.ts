import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { buildSandboxImage, type BuildSandboxImageResult } from "./sandbox-image.js";

type InspectSpawnOptions = {
  stdio: ["ignore", "ignore", "ignore"];
};

type InspectSpawnedProcess = {
  on(event: "close", listener: (code: number | null) => void): InspectSpawnedProcess;
  on(event: "error", listener: (error: Error) => void): InspectSpawnedProcess;
};

type InspectSpawnLike = (
  command: string,
  args: string[],
  options: InspectSpawnOptions,
) => InspectSpawnedProcess;

export type ExecdRuntime = {
  getPackageVersion: () => Promise<string>;
  inspectDockerImage: (imageTag: string) => Promise<boolean>;
  moduleUrl: string;
};

export type ExecdRuntimeDependencies = {
  readFileImpl?: typeof readFile;
  getPackageVersion?: () => Promise<string>;
  inspectDockerImage?: (imageTag: string) => Promise<boolean>;
  inspectSpawnImpl?: InspectSpawnLike;
  moduleUrl?: string;
};

const DEFAULT_INSPECT_STDIO: InspectSpawnOptions["stdio"] = ["ignore", "ignore", "ignore"];

const defaultInspectSpawn: InspectSpawnLike = (command, args, options) => {
  return spawn(command, args, options);
};

function resolvePackageRoot(moduleUrl: string): string {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  return resolve(moduleDir, "../../..");
}

async function readPackageVersion(input: {
  readFileImpl: typeof readFile;
  moduleUrl: string;
}): Promise<string> {
  const packageJsonPath = join(resolvePackageRoot(input.moduleUrl), "package.json");
  const packageJson = JSON.parse(await input.readFileImpl(packageJsonPath, "utf8")) as {
    version?: unknown;
  };

  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error(`Invalid or missing "version" in ${packageJsonPath}.`);
  }

  return packageJson.version;
}

async function inspectLocalDockerImage(input: {
  imageTag: string;
  spawnImpl: InspectSpawnLike;
}): Promise<boolean> {
  return await new Promise<boolean>((resolvePromise, rejectPromise) => {
    const child = input.spawnImpl("docker", ["image", "inspect", input.imageTag], {
      stdio: DEFAULT_INSPECT_STDIO,
    });

    child.on("error", (error) => {
      rejectPromise(new Error(`Failed to inspect docker image ${input.imageTag}: ${error.message}`));
    });

    child.on("close", (code) => {
      resolvePromise(code === 0);
    });
  });
}

function ensureDockerBuildSucceeded(result: BuildSandboxImageResult): void {
  if (result.exitCode !== 0) {
    throw new Error(`docker build failed with exit code ${result.exitCode}.`);
  }
}

export function resolveExecdRuntimeDependencies(
  input: ExecdRuntimeDependencies = {},
): ExecdRuntime {
  const moduleUrl = input.moduleUrl ?? import.meta.url;
  const readFileImpl = input.readFileImpl ?? readFile;
  const getPackageVersion = input.getPackageVersion
    ?? (async (): Promise<string> => {
      return await readPackageVersion({
        readFileImpl,
        moduleUrl,
      });
    });
  const inspectDockerImage = input.inspectDockerImage
    ?? (async (imageTag: string): Promise<boolean> => {
      return await inspectLocalDockerImage({
        imageTag,
        spawnImpl: input.inspectSpawnImpl ?? defaultInspectSpawn,
      });
    });

  return {
    getPackageVersion,
    inspectDockerImage,
    moduleUrl,
  };
}

export async function ensureExecdBaseImage(input: {
  buildSandbox: typeof buildSandboxImage;
  stdout: Writable;
  stderr: Writable;
  runtime: ExecdRuntime;
}): Promise<string> {
  const version = await input.runtime.getPackageVersion();
  const imageTag = `agent-bundle/execd:${version}`;

  if (await input.runtime.inspectDockerImage(imageTag)) {
    input.stdout.write(`Using cached execd base image: ${imageTag}\n`);
    return imageTag;
  }

  input.stdout.write(`Building execd base image with Docker: ${imageTag}\n`);
  const buildResult = await input.buildSandbox({
    bundleDir: join(resolvePackageRoot(input.runtime.moduleUrl), "dist", "execd"),
    dockerfile: "Dockerfile",
    imageTag,
    stdout: input.stdout,
    stderr: input.stderr,
  });
  ensureDockerBuildSucceeded(buildResult);

  return imageTag;
}
