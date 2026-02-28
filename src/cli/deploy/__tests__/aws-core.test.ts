import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import {
  awsCliExec,
  awsCliJson,
  errorHasCode,
  runCommand,
  type AwsCliExecOptions,
  type CommandRunner,
} from "../aws-cli.js";
import { ensureAwsPrerequisites } from "../aws-prerequisites.js";

function createSuccessfulResult(): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
  };
}

it("runCommand streams stdout/stderr and returns exit code", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutText = "";
  let stderrText = "";

  stdout.on("data", (chunk: Buffer | string) => {
    stdoutText += chunk.toString();
  });
  stderr.on("data", (chunk: Buffer | string) => {
    stderrText += chunk.toString();
  });

  const result = await runCommand(
    process.execPath,
    ["-e", "process.stdout.write('hello');process.stderr.write('warn');"],
    { stdout, stderr },
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("hello");
  expect(result.stderr).toContain("warn");
  expect(stdoutText).toContain("hello");
  expect(stderrText).toContain("warn");
});

it("runCommand rejects on non-zero exit when allowNonZeroExit is false", async () => {
  await expect(
    runCommand(process.execPath, ["-e", "process.exit(17)"]),
  ).rejects.toThrow("Command failed (17)");
});

it("runCommand returns result on non-zero exit when allowNonZeroExit is true", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "process.stderr.write('failed');process.exit(3)"],
    { allowNonZeroExit: true },
  );

  expect(result.exitCode).toBe(3);
  expect(result.stderr).toContain("failed");
});

it("awsCliExec appends region and output flags", async () => {
  const runCommandMock = vi
    .fn<CommandRunner>()
    .mockResolvedValue(createSuccessfulResult());

  await awsCliExec({
    region: "us-east-1",
    args: ["ecs", "describe-clusters"],
    runCommandImpl: runCommandMock,
  });

  expect(runCommandMock).toHaveBeenCalledWith(
    "aws",
    ["ecs", "describe-clusters", "--region", "us-east-1", "--output", "json"],
    expect.any(Object),
  );
});

it("awsCliJson parses JSON and surfaces parser errors", async () => {
  const runCommandOk = vi
    .fn<CommandRunner>()
    .mockResolvedValue({
      exitCode: 0,
      stdout: '{"ok":true}',
      stderr: "",
    });
  const parsed = await awsCliJson<{ ok: boolean }>({
    region: "us-east-1",
    args: ["sts", "get-caller-identity"],
    runCommandImpl: runCommandOk,
  });

  expect(parsed.ok).toBe(true);

  const runCommandBad = vi
    .fn<CommandRunner>()
    .mockResolvedValue({
      exitCode: 0,
      stdout: "not-json",
      stderr: "",
    });

  await expect(
    awsCliJson({
      region: "us-east-1",
      args: ["ecs", "describe-clusters"],
      runCommandImpl: runCommandBad,
    }),
  ).rejects.toThrow("Failed to parse AWS CLI JSON output");
});

it("ensureAwsPrerequisites validates required tools and STS", async () => {
  const runCommandMock = vi
    .fn<CommandRunner>()
    .mockResolvedValue(createSuccessfulResult());
  const awsCliJsonMock = vi
    .fn<(<T>(options: AwsCliExecOptions) => Promise<T>)>()
    .mockResolvedValue({
      Account: "123456789012",
      Arn: "arn:aws:iam::123456789012:user/test",
      UserId: "AIDATEST",
    } as never);

  const result = await ensureAwsPrerequisites({
    region: "us-east-1",
    runCommandImpl: runCommandMock,
    awsCliJsonImpl: awsCliJsonMock,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });

  expect(runCommandMock).toHaveBeenCalledWith("aws", ["--version"]);
  expect(runCommandMock).toHaveBeenCalledWith("docker", ["--version"]);
  expect(awsCliJsonMock).toHaveBeenCalledWith(
    expect.objectContaining({
      region: "us-east-1",
      args: ["sts", "get-caller-identity"],
    }),
  );
  expect(result).toEqual({
    accountId: "123456789012",
    arn: "arn:aws:iam::123456789012:user/test",
    userId: "AIDATEST",
  });
});

it("ensureAwsPrerequisites can skip docker check", async () => {
  const runCommandMock = vi
    .fn<CommandRunner>()
    .mockResolvedValue(createSuccessfulResult());
  const awsCliJsonMock = vi
    .fn<(<T>(options: AwsCliExecOptions) => Promise<T>)>()
    .mockResolvedValue({ Account: "1", Arn: "arn", UserId: "uid" } as never);

  await ensureAwsPrerequisites({
    region: "us-east-1",
    requireDocker: false,
    runCommandImpl: runCommandMock,
    awsCliJsonImpl: awsCliJsonMock,
    stdout: new PassThrough(),
  });

  expect(runCommandMock).toHaveBeenCalledTimes(1);
  expect(runCommandMock).toHaveBeenCalledWith("aws", ["--version"]);
});

it("errorHasCode matches AWS error strings", () => {
  expect(errorHasCode(new Error("ResourceExistsException: already exists"), "ResourceExistsException")).toBe(true);
  expect(errorHasCode(new Error("DifferentError"), "ResourceExistsException")).toBe(false);
});
