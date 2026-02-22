import { spawn } from "node:child_process";
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

export type BuildE2BTemplateOptions = {
  bundleDir: string;
  template: string;
  spawnImpl?: SpawnLike;
  stdout?: Writable;
  stderr?: Writable;
};

export type BuildE2BTemplateResult = {
  templateRef: string;
  exitCode: number;
};

const DEFAULT_STDIO: SpawnOptions["stdio"] = ["ignore", "pipe", "pipe"];

const defaultSpawn: SpawnLike = (command, args, options) => {
  return spawn(command, args, options);
};

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

export async function buildE2BTemplate(
  options: BuildE2BTemplateOptions,
): Promise<BuildE2BTemplateResult> {
  const spawnImpl = options.spawnImpl ?? defaultSpawn;
  const output = options.stdout ?? process.stdout;
  const errorOutput = options.stderr ?? process.stderr;
  const args = ["template", "build", "--path", options.bundleDir, options.template];
  let commandOutput = "";

  return await new Promise<BuildE2BTemplateResult>((resolvePromise, rejectPromise) => {
    const child = spawnImpl("e2b", args, { stdio: DEFAULT_STDIO });

    pipeIfPresent(child.stdout, output, (chunk) => {
      commandOutput += chunk.toString();
    });
    pipeIfPresent(child.stderr, errorOutput, (chunk) => {
      commandOutput += chunk.toString();
    });

    child.on("error", (error) => {
      rejectPromise(new Error(`Failed to start e2b template build: ${error.message}`));
    });

    child.on("close", (code) => {
      resolvePromise({
        templateRef: detectTemplateRef(commandOutput, options.template),
        exitCode: code ?? 1,
      });
    });
  });
}
