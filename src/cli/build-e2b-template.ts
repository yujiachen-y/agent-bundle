import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";

import { Template, type TemplateClass } from "e2b";

import type { Skill } from "../skills/loader.js";

type SpawnOptions = {
  stdio: ["ignore", "pipe", "pipe"];
  env?: NodeJS.ProcessEnv;
};

type SpawnedProcess = {
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: "close", listener: (code: number | null) => void): SpawnedProcess;
  on(event: "error", listener: (error: Error) => void): SpawnedProcess;
};

type TemplateBuildLog = {
  toString(): string;
};

type TemplateBuildImpl = (
  template: TemplateClass,
  name: string,
  options?: {
    onBuildLogs?: (entry: TemplateBuildLog) => void;
  },
) => Promise<{
  name: string;
}>;

export type SpawnLike = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => SpawnedProcess;

export type BuildE2BTemplateOptions = {
  bundleDir: string;
  template: string;
  skills: Skill[];
  templateBuildImpl?: TemplateBuildImpl;
  spawnImpl?: SpawnLike;
  stdout?: Writable;
  stderr?: Writable;
};

export type BuildE2BTemplateResult = {
  templateRef: string;
  exitCode: number;
};

const DEFAULT_STDIO: SpawnOptions["stdio"] = ["ignore", "pipe", "pipe"];
const E2B_DOCKERFILE_NAME = "e2b.Dockerfile";
const E2B_DOCKERFILE_CONTENT = [
  "FROM e2bdev/base:latest",
  "RUN mkdir -p /skills /tools /workspace",
  "COPY ./skills/ /skills/",
  "COPY ./tools/ /tools/",
  "",
].join("\n");

const defaultSpawn: SpawnLike = (command, args, options) => {
  return spawn(command, args, options);
};

const defaultTemplateBuild: TemplateBuildImpl = async (template, name, options) => {
  return await Template.build(template, name, options);
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function pipeIfPresent(
  stream: Readable | null,
  output: Writable,
  onData?: (chunk: Buffer | string) => void,
): void {
  if (!stream) {
    return;
  }

  stream.on("data", (chunk: Buffer | string) => {
    output.write(chunk);
    onData?.(chunk);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectTemplateRef(output: string, fallback: string): string {
  const [templateName] = fallback.split(":");
  const pattern = new RegExp(
    `\\b(${escapeRegExp(templateName)}:[A-Za-z0-9][A-Za-z0-9._-]*)\\b`,
    "g",
  );
  const refs = Array.from(output.matchAll(pattern)).map((match) => match[1]);
  const latestRef = refs.at(-1);

  return latestRef ?? fallback;
}

function sanitizeSegment(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "skill";
}

function isRemoteSourcePath(path: string): boolean {
  return /^https?:\/\//.test(path);
}

function toCliSpawnEnv(): NodeJS.ProcessEnv {
  if (process.env.E2B_ACCESS_TOKEN || !process.env.E2B_API_KEY) {
    return process.env;
  }

  return {
    ...process.env,
    E2B_ACCESS_TOKEN: process.env.E2B_API_KEY,
  };
}

async function copyDirectoryRecursive(sourcePath: string, destinationPath: string): Promise<void> {
  await mkdir(destinationPath, { recursive: true });
  const entries = await readdir(sourcePath, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const sourceEntryPath = join(sourcePath, entry.name);
      const destinationEntryPath = join(destinationPath, entry.name);

      if (entry.isDirectory()) {
        await copyDirectoryRecursive(sourceEntryPath, destinationEntryPath);
        return;
      }

      if (entry.isFile()) {
        await copyFile(sourceEntryPath, destinationEntryPath);
      }
    }),
  );
}

async function copyLocalSkillFiles(skill: Skill, destinationPath: string): Promise<void> {
  if (isRemoteSourcePath(skill.sourcePath)) {
    return;
  }

  const sourceSkillDir = dirname(skill.sourcePath);
  const sourceEntries = await readdir(sourceSkillDir, { withFileTypes: true });

  await Promise.all(
    sourceEntries.map(async (entry) => {
      if (entry.name === "SKILL.md") {
        return;
      }

      const sourceEntryPath = join(sourceSkillDir, entry.name);
      const destinationEntryPath = join(destinationPath, entry.name);

      if (entry.isDirectory()) {
        await copyDirectoryRecursive(sourceEntryPath, destinationEntryPath);
        return;
      }

      if (entry.isFile()) {
        await copyFile(sourceEntryPath, destinationEntryPath);
      }
    }),
  );
}

async function writeSkillsBuildContext(contextDir: string, skills: Skill[]): Promise<void> {
  const skillsDir = join(contextDir, "skills");
  await mkdir(skillsDir, { recursive: true });

  await Promise.all(
    skills.map(async (skill, index) => {
      const skillDirName = `${String(index + 1).padStart(2, "0")}-${sanitizeSegment(skill.name)}`;
      const skillDir = join(skillsDir, skillDirName);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), skill.content, "utf8");
      await copyLocalSkillFiles(skill, skillDir);
    }),
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function writeToolsBuildContext(contextDir: string, bundleDir: string): Promise<void> {
  const destinationToolsPath = join(contextDir, "tools");
  const sourceToolsPath = join(bundleDir, "tools");

  if (await pathExists(sourceToolsPath)) {
    await copyDirectoryRecursive(sourceToolsPath, destinationToolsPath);
    return;
  }

  await mkdir(destinationToolsPath, { recursive: true });
}

async function createBuildContext(options: BuildE2BTemplateOptions): Promise<string> {
  const contextDir = await mkdtemp(join(tmpdir(), "agent-bundle-e2b-"));
  await writeSkillsBuildContext(contextDir, options.skills);
  await writeToolsBuildContext(contextDir, options.bundleDir);
  await writeFile(join(contextDir, E2B_DOCKERFILE_NAME), E2B_DOCKERFILE_CONTENT, "utf8");

  return contextDir;
}

async function runTemplateBuildSdk(input: {
  contextDir: string;
  template: string;
  templateBuildImpl: TemplateBuildImpl;
  stdout: Writable;
}): Promise<BuildE2BTemplateResult> {
  const template = Template({ fileContextPath: input.contextDir }).fromDockerfile(
    join(input.contextDir, E2B_DOCKERFILE_NAME),
  );
  const buildInfo = await input.templateBuildImpl(template, input.template, {
    onBuildLogs: (entry) => {
      input.stdout.write(`${entry.toString()}\n`);
    },
  });

  return {
    templateRef: buildInfo.name || input.template,
    exitCode: 0,
  };
}

async function runTemplateBuildCli(input: {
  contextDir: string;
  template: string;
  spawnImpl: SpawnLike;
  stdout: Writable;
  stderr: Writable;
}): Promise<BuildE2BTemplateResult> {
  const args = ["template", "build", "--path", input.contextDir, input.template];
  let stdoutOutput = "";
  let commandOutput = "";

  return await new Promise<BuildE2BTemplateResult>((resolvePromise, rejectPromise) => {
    const child = input.spawnImpl("e2b", args, {
      stdio: DEFAULT_STDIO,
      env: toCliSpawnEnv(),
    });

    pipeIfPresent(child.stdout, input.stdout, (chunk) => {
      const text = chunk.toString();
      stdoutOutput += text;
      commandOutput += text;
    });
    pipeIfPresent(child.stderr, input.stderr, (chunk) => {
      commandOutput += chunk.toString();
    });

    child.on("error", (error) => {
      rejectPromise(new Error(`Failed to start e2b template build: ${error.message}`));
    });

    child.on("close", (code) => {
      const stdoutTemplateRef = detectTemplateRef(stdoutOutput, input.template);
      resolvePromise({
        templateRef: stdoutTemplateRef === input.template
          ? detectTemplateRef(commandOutput, input.template)
          : stdoutTemplateRef,
        exitCode: code ?? 1,
      });
    });
  });
}

async function runTemplateBuildWithFallback(input: {
  contextDir: string;
  template: string;
  templateBuildImpl: TemplateBuildImpl;
  spawnImpl: SpawnLike;
  stdout: Writable;
  stderr: Writable;
}): Promise<BuildE2BTemplateResult> {
  try {
    return await runTemplateBuildSdk({
      contextDir: input.contextDir,
      template: input.template,
      templateBuildImpl: input.templateBuildImpl,
      stdout: input.stdout,
    });
  } catch (error) {
    input.stderr.write(
      `E2B SDK template build failed (${error instanceof Error ? error.message : String(error)}). Falling back to e2b CLI.\n`,
    );

    return await runTemplateBuildCli({
      contextDir: input.contextDir,
      template: input.template,
      spawnImpl: input.spawnImpl,
      stdout: input.stdout,
      stderr: input.stderr,
    });
  }
}

export async function buildE2BTemplate(
  options: BuildE2BTemplateOptions,
): Promise<BuildE2BTemplateResult> {
  const spawnImpl = options.spawnImpl ?? defaultSpawn;
  const templateBuildImpl = options.templateBuildImpl ?? defaultTemplateBuild;
  const output = options.stdout ?? process.stdout;
  const errorOutput = options.stderr ?? process.stderr;
  const contextDir = await createBuildContext(options);

  try {
    return await runTemplateBuildWithFallback({
      contextDir,
      template: options.template,
      templateBuildImpl,
      spawnImpl,
      stdout: output,
      stderr: errorOutput,
    });
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
}
