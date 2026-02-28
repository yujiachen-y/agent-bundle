import type { Writable } from "node:stream";

import {
  awsCliExec,
  awsCliJson,
  type AwsCliExecOptions,
} from "./aws-cli.js";
import { createAwsDeploymentNames } from "./aws-ecs-shared.js";

type ListTaskDefinitionsOutput = {
  taskDefinitionArns?: string[];
};

type DescribeServicesOutput = {
  services: Array<{
    status?: string;
  }>;
};

type DescribeSecurityGroupsOutput = {
  SecurityGroups: Array<{
    GroupId: string;
  }>;
};

export type TeardownAwsResourcesOptions = {
  region: string;
  bundleName: string;
  stdout?: Writable;
  stderr?: Writable;
  awsCliExecImpl?: (options: AwsCliExecOptions) => Promise<{ stdout: string }>;
  awsCliJsonImpl?: <T>(options: AwsCliExecOptions) => Promise<T>;
};

async function runBestEffort(
  label: string,
  action: () => Promise<void>,
  stdout: Writable,
  stderr: Writable,
): Promise<void> {
  try {
    stdout.write(`[deploy/aws] ${label}\n`);
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`[deploy/aws] warning: ${label} failed: ${message}\n`);
  }
}

async function deleteService(input: {
  region: string;
  clusterName: string;
  serviceName: string;
  stderr?: Writable;
  awsCliExecImpl: (options: AwsCliExecOptions) => Promise<{ stdout: string }>;
  awsCliJsonImpl: <T>(options: AwsCliExecOptions) => Promise<T>;
}): Promise<void> {
  const described = await input.awsCliJsonImpl<DescribeServicesOutput>({
    region: input.region,
    args: ["ecs", "describe-services", "--cluster", input.clusterName, "--services", input.serviceName],
    stderr: input.stderr,
  });
  const service = described.services[0];

  if (!service?.status || service.status === "INACTIVE") {
    return;
  }

  await input.awsCliExecImpl({
    region: input.region,
    args: [
      "ecs",
      "update-service",
      "--cluster",
      input.clusterName,
      "--service",
      input.serviceName,
      "--desired-count",
      "0",
    ],
    stderr: input.stderr,
  });

  await input.awsCliExecImpl({
    region: input.region,
    args: [
      "ecs",
      "delete-service",
      "--cluster",
      input.clusterName,
      "--service",
      input.serviceName,
      "--force",
    ],
    stderr: input.stderr,
  });
}

async function deregisterTaskDefinitions(input: {
  region: string;
  taskFamily: string;
  stderr?: Writable;
  awsCliExecImpl: (options: AwsCliExecOptions) => Promise<{ stdout: string }>;
  awsCliJsonImpl: <T>(options: AwsCliExecOptions) => Promise<T>;
}): Promise<void> {
  const listed = await input.awsCliJsonImpl<ListTaskDefinitionsOutput>({
    region: input.region,
    args: ["ecs", "list-task-definitions", "--family-prefix", input.taskFamily],
    stderr: input.stderr,
  });

  const taskDefinitionArns = listed.taskDefinitionArns ?? [];
  await Promise.all(
    taskDefinitionArns.map(async (taskDefinitionArn) => {
      await input.awsCliExecImpl({
        region: input.region,
        args: ["ecs", "deregister-task-definition", "--task-definition", taskDefinitionArn],
        stderr: input.stderr,
      });
    }),
  );
}

async function deleteSecurityGroup(input: {
  region: string;
  securityGroupName: string;
  stderr?: Writable;
  awsCliExecImpl: (options: AwsCliExecOptions) => Promise<{ stdout: string }>;
  awsCliJsonImpl: <T>(options: AwsCliExecOptions) => Promise<T>;
}): Promise<void> {
  const described = await input.awsCliJsonImpl<DescribeSecurityGroupsOutput>({
    region: input.region,
    args: [
      "ec2",
      "describe-security-groups",
      "--filters",
      `Name=group-name,Values=${input.securityGroupName}`,
    ],
    stderr: input.stderr,
  });
  const groupId = described.SecurityGroups[0]?.GroupId;

  if (!groupId) {
    return;
  }

  await input.awsCliExecImpl({
    region: input.region,
    args: ["ec2", "delete-security-group", "--group-id", groupId],
    stderr: input.stderr,
  });
}

type TeardownStep = {
  label: string;
  action: () => Promise<void>;
};

type TeardownStepInput = {
  options: TeardownAwsResourcesOptions;
  names: ReturnType<typeof createAwsDeploymentNames>;
  awsCliExecImpl: (options: AwsCliExecOptions) => Promise<{ stdout: string }>;
  awsCliJsonImpl: <T>(options: AwsCliExecOptions) => Promise<T>;
};

function createServiceTeardownSteps(input: TeardownStepInput): TeardownStep[] {
  return [
    {
      label: `Deleting ECS service ${input.names.serviceName}`,
      action: async () => {
        await deleteService({
          region: input.options.region,
          clusterName: input.names.clusterName,
          serviceName: input.names.serviceName,
          stderr: input.options.stderr,
          awsCliExecImpl: input.awsCliExecImpl,
          awsCliJsonImpl: input.awsCliJsonImpl,
        });
      },
    },
    {
      label: `Deregistering ECS task definitions for ${input.names.taskFamily}`,
      action: async () => {
        await deregisterTaskDefinitions({
          region: input.options.region,
          taskFamily: input.names.taskFamily,
          stderr: input.options.stderr,
          awsCliExecImpl: input.awsCliExecImpl,
          awsCliJsonImpl: input.awsCliJsonImpl,
        });
      },
    },
    {
      label: `Deleting ECS cluster ${input.names.clusterName}`,
      action: async () => {
        await input.awsCliExecImpl({
          region: input.options.region,
          args: ["ecs", "delete-cluster", "--cluster", input.names.clusterName],
          stderr: input.options.stderr,
        });
      },
    },
    {
      label: `Deleting security group ${input.names.securityGroupName}`,
      action: async () => {
        await deleteSecurityGroup({
          region: input.options.region,
          securityGroupName: input.names.securityGroupName,
          stderr: input.options.stderr,
          awsCliExecImpl: input.awsCliExecImpl,
          awsCliJsonImpl: input.awsCliJsonImpl,
        });
      },
    },
  ];
}

function createResourceTeardownSteps(input: TeardownStepInput): TeardownStep[] {
  return [
    {
      label: `Deleting secret ${input.names.secretName}`,
      action: async () => {
        await input.awsCliExecImpl({
          region: input.options.region,
          args: [
            "secretsmanager",
            "delete-secret",
            "--secret-id",
            input.names.secretName,
            "--force-delete-without-recovery",
          ],
          stderr: input.options.stderr,
        });
      },
    },
    {
      label: `Deleting ECR repository ${input.names.prefix}`,
      action: async () => {
        await input.awsCliExecImpl({
          region: input.options.region,
          args: ["ecr", "delete-repository", "--repository-name", input.names.prefix, "--force"],
          stderr: input.options.stderr,
        });
      },
    },
    {
      label: `Deleting CloudWatch log group ${input.names.logGroupName}`,
      action: async () => {
        await input.awsCliExecImpl({
          region: input.options.region,
          args: ["logs", "delete-log-group", "--log-group-name", input.names.logGroupName],
          stderr: input.options.stderr,
        });
      },
    },
  ];
}

function createTeardownSteps(input: TeardownStepInput): TeardownStep[] {
  return [
    ...createServiceTeardownSteps(input),
    ...createResourceTeardownSteps(input),
  ];
}

async function runTeardownSteps(steps: TeardownStep[], stdout: Writable, stderr: Writable): Promise<void> {
  await steps.reduce<Promise<void>>(async (previous, step) => {
    await previous;
    await runBestEffort(step.label, step.action, stdout, stderr);
  }, Promise.resolve());
}

export async function teardownAwsResources(options: TeardownAwsResourcesOptions): Promise<void> {
  const awsCliExecImpl = options.awsCliExecImpl ?? awsCliExec;
  const awsCliJsonImpl = options.awsCliJsonImpl ?? awsCliJson;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const names = createAwsDeploymentNames(options.bundleName);
  const steps = createTeardownSteps({
    options,
    names,
    awsCliExecImpl,
    awsCliJsonImpl,
  });

  await runTeardownSteps(steps, stdout, stderr);
}
