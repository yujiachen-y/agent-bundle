import type { Writable } from "node:stream";

import {
  awsCliJson,
  runCommand,
  type AwsCliExecOptions,
  type CommandRunner,
} from "./aws-cli.js";

type CallerIdentity = {
  Account: string;
  Arn: string;
  UserId: string;
};

export type EnsureAwsPrerequisitesOptions = {
  region: string;
  requireDocker?: boolean;
  stdout?: Writable;
  stderr?: Writable;
  runCommandImpl?: CommandRunner;
  awsCliJsonImpl?: <T>(options: AwsCliExecOptions) => Promise<T>;
};

export type EnsureAwsPrerequisitesResult = {
  accountId: string;
  arn: string;
  userId: string;
};

async function ensureCommandExists(
  command: string,
  runCommandImpl: CommandRunner,
): Promise<void> {
  await runCommandImpl(command, ["--version"]);
}

export async function ensureAwsPrerequisites(
  options: EnsureAwsPrerequisitesOptions,
): Promise<EnsureAwsPrerequisitesResult> {
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const awsCliJsonImpl = options.awsCliJsonImpl ?? awsCliJson;
  const stdout = options.stdout ?? process.stdout;
  const requireDocker = options.requireDocker !== false;

  stdout.write("[deploy/aws] Checking AWS CLI availability\n");
  await ensureCommandExists("aws", runCommandImpl);

  if (requireDocker) {
    stdout.write("[deploy/aws] Checking Docker CLI availability\n");
    await ensureCommandExists("docker", runCommandImpl);
  }

  stdout.write("[deploy/aws] Verifying AWS credentials with STS\n");
  const identity = await awsCliJsonImpl<CallerIdentity>({
    region: options.region,
    args: ["sts", "get-caller-identity"],
    stderr: options.stderr,
  });

  return {
    accountId: identity.Account,
    arn: identity.Arn,
    userId: identity.UserId,
  };
}
