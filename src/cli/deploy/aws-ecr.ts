import type { Writable } from "node:stream";

import {
  awsCliExec,
  awsCliJson,
  errorHasCode,
  runCommand,
  type AwsCliExecOptions,
  type CommandRunner,
} from "./aws-cli.js";

type EcrRepository = {
  repositoryName: string;
  repositoryUri: string;
};

type DescribeRepositoriesOutput = {
  repositories: EcrRepository[];
};

type CreateRepositoryOutput = {
  repository: EcrRepository;
};

export type PushImageToEcrOptions = {
  region: string;
  bundleName: string;
  localImageRef: string;
  stdout?: Writable;
  stderr?: Writable;
  awsCliExecImpl?: (options: AwsCliExecOptions) => Promise<{ stdout: string }>;
  awsCliJsonImpl?: <T>(options: AwsCliExecOptions) => Promise<T>;
  runCommandImpl?: CommandRunner;
};

export type PushImageToEcrResult = {
  repositoryName: string;
  repositoryUri: string;
  imageUri: string;
};

function toRepositoryName(bundleName: string): string {
  return `agent-bundle-${bundleName}`;
}

function toRepositoryHost(repositoryUri: string): string {
  const [host] = repositoryUri.split("/");
  if (!host) {
    throw new Error(`Invalid ECR repository URI: ${repositoryUri}`);
  }

  return host;
}

async function ensureRepository(input: {
  region: string;
  repositoryName: string;
  stderr?: Writable;
  awsCliJsonImpl: <T>(options: AwsCliExecOptions) => Promise<T>;
}): Promise<EcrRepository> {
  try {
    const described = await input.awsCliJsonImpl<DescribeRepositoriesOutput>({
      region: input.region,
      args: ["ecr", "describe-repositories", "--repository-names", input.repositoryName],
      stderr: input.stderr,
    });

    const repository = described.repositories[0];
    if (!repository) {
      throw new Error(`ECR repository ${input.repositoryName} was not returned by describe-repositories.`);
    }

    return repository;
  } catch (error) {
    if (!errorHasCode(error, "RepositoryNotFoundException")) {
      throw error;
    }

    const created = await input.awsCliJsonImpl<CreateRepositoryOutput>({
      region: input.region,
      args: ["ecr", "create-repository", "--repository-name", input.repositoryName],
      stderr: input.stderr,
    });

    if (!created.repository?.repositoryUri) {
      throw new Error(`Failed to create ECR repository ${input.repositoryName}.`);
    }

    return created.repository;
  }
}

async function dockerLoginToEcr(input: {
  region: string;
  repositoryHost: string;
  stdout?: Writable;
  stderr?: Writable;
  awsCliExecImpl: (options: AwsCliExecOptions) => Promise<{ stdout: string }>;
  runCommandImpl: CommandRunner;
}): Promise<void> {
  const passwordResult = await input.awsCliExecImpl({
    region: input.region,
    args: ["ecr", "get-login-password"],
    outputJson: false,
    stderr: input.stderr,
  });
  const password = passwordResult.stdout;

  if (password.trim().length === 0) {
    throw new Error("AWS ECR login password output was empty.");
  }

  await input.runCommandImpl(
    "docker",
    ["login", "--username", "AWS", "--password-stdin", input.repositoryHost],
    {
      input: password,
      stdout: input.stdout,
      stderr: input.stderr,
    },
  );
}

export async function pushImageToEcr(options: PushImageToEcrOptions): Promise<PushImageToEcrResult> {
  const stdout = options.stdout ?? process.stdout;
  const awsCliExecImpl = options.awsCliExecImpl ?? awsCliExec;
  const awsCliJsonImpl = options.awsCliJsonImpl ?? awsCliJson;
  const runCommandImpl = options.runCommandImpl ?? runCommand;
  const repositoryName = toRepositoryName(options.bundleName);

  stdout.write(`[deploy/aws] Ensuring ECR repository ${repositoryName}\n`);
  const repository = await ensureRepository({
    region: options.region,
    repositoryName,
    stderr: options.stderr,
    awsCliJsonImpl,
  });

  const repositoryHost = toRepositoryHost(repository.repositoryUri);
  stdout.write(`[deploy/aws] Logging in Docker to ECR host ${repositoryHost}\n`);
  await dockerLoginToEcr({
    region: options.region,
    repositoryHost,
    stdout: options.stdout,
    stderr: options.stderr,
    awsCliExecImpl,
    runCommandImpl,
  });

  const imageUri = `${repository.repositoryUri}:latest`;
  stdout.write(`[deploy/aws] Tagging image ${options.localImageRef} as ${imageUri}\n`);
  await runCommandImpl("docker", ["tag", options.localImageRef, imageUri], {
    stdout: options.stdout,
    stderr: options.stderr,
  });

  stdout.write(`[deploy/aws] Pushing image ${imageUri}\n`);
  await runCommandImpl("docker", ["push", imageUri], {
    stdout: options.stdout,
    stderr: options.stderr,
  });

  return {
    repositoryName,
    repositoryUri: repository.repositoryUri,
    imageUri,
  };
}
