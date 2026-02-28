import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

type SpawnOptions = {
  stdio: ["pipe", "pipe", "pipe"];
  env?: NodeJS.ProcessEnv;
};

type SpawnedProcess = {
  readonly stdin: Writable | null;
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

export type RunCommandOptions = {
  env?: NodeJS.ProcessEnv;
  input?: string;
  stdout?: Writable;
  stderr?: Writable;
  allowNonZeroExit?: boolean;
};

export type RunCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: RunCommandOptions,
) => Promise<RunCommandResult>;

export type AwsCliExecOptions = {
  region: string;
  args: string[];
  outputJson?: boolean;
  env?: NodeJS.ProcessEnv;
  input?: string;
  stdout?: Writable;
  stderr?: Writable;
  allowNonZeroExit?: boolean;
  runCommandImpl?: CommandRunner;
};

const DEFAULT_STDIO: SpawnOptions["stdio"] = ["pipe", "pipe", "pipe"];

const defaultSpawn: SpawnLike = (command, args, options) => {
  return spawn(command, args, options);
};

function pipeIfPresent(stream: Readable | null, output: Writable | undefined, onData: (text: string) => void): void {
  if (!stream) {
    return;
  }

  stream.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    output?.write(text);
    onData(text);
  });
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

export const runCommand: CommandRunner = async (command, args, options = {}) => {
  return await new Promise<RunCommandResult>((resolvePromise, rejectPromise) => {
    const child = defaultSpawn(command, args, {
      stdio: DEFAULT_STDIO,
      env: options.env,
    });

    let stdout = "";
    let stderr = "";

    pipeIfPresent(child.stdout, options.stdout, (text) => {
      stdout += text;
    });
    pipeIfPresent(child.stderr, options.stderr, (text) => {
      stderr += text;
    });

    if (options.input !== undefined) {
      child.stdin?.write(options.input);
      child.stdin?.end();
    }

    child.on("error", (error) => {
      rejectPromise(new Error(`Failed to start ${formatCommand(command, args)}: ${error.message}`));
    });

    child.on("close", (code) => {
      const exitCode = code ?? 1;
      const result: RunCommandResult = {
        exitCode,
        stdout,
        stderr,
      };

      if (exitCode !== 0 && options.allowNonZeroExit !== true) {
        const stderrText = stderr.trim().length > 0 ? stderr.trim() : "<empty stderr>";
        rejectPromise(
          new Error(`Command failed (${exitCode}): ${formatCommand(command, args)}\n${stderrText}`),
        );
        return;
      }

      resolvePromise(result);
    });
  });
};

function withAwsFlags(args: string[], region: string, outputJson: boolean): string[] {
  const finalArgs = [...args, "--region", region];
  if (outputJson) {
    finalArgs.push("--output", "json");
  }

  return finalArgs;
}

export async function awsCliExec(options: AwsCliExecOptions): Promise<RunCommandResult> {
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const outputJson = options.outputJson !== false;

  return await runCommandImpl(
    "aws",
    withAwsFlags(options.args, options.region, outputJson),
    {
      env: options.env,
      input: options.input,
      stdout: options.stdout,
      stderr: options.stderr,
      allowNonZeroExit: options.allowNonZeroExit,
    },
  );
}

export async function awsCliJson<T>(options: AwsCliExecOptions): Promise<T> {
  const result = await awsCliExec({
    ...options,
    outputJson: true,
  });
  const body = result.stdout.trim();

  if (body.length === 0) {
    throw new Error(`AWS CLI returned empty JSON output for: aws ${options.args.join(" ")}`);
  }

  try {
    return JSON.parse(body) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse AWS CLI JSON output: ${message}`);
  }
}

export function errorHasCode(error: unknown, awsErrorCode: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(awsErrorCode);
}
