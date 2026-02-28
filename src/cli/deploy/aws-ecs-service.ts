import type { Writable } from "node:stream";

import {
  type AwsCliExecJson,
  type AwsCliExecText,
  type AwsEcsDeployConfig,
  type DeploymentNames,
  toNetworkConfiguration,
  toSecretEnvRefs,
} from "./aws-ecs-shared.js";

type DescribeLogGroupsOutput = {
  logGroups?: Array<{
    logGroupName?: string;
  }>;
};

type RegisterTaskDefinitionOutput = {
  taskDefinition?: {
    taskDefinitionArn?: string;
  };
};

type DescribeServicesOutput = {
  services: Array<{
    status?: string;
  }>;
};

type ListTasksOutput = {
  taskArns?: string[];
};

type DescribeTasksOutput = {
  tasks?: Array<{
    attachments?: Array<{
      details?: Array<{
        name?: string;
        value?: string;
      }>;
    }>;
  }>;
};

type DescribeNetworkInterfacesOutput = {
  NetworkInterfaces?: Array<{
    Association?: {
      PublicIp?: string;
    };
  }>;
};

export async function ensureLogGroup(input: {
  region: string;
  logGroupName: string;
  stderr?: Writable;
  awsCliExecImpl: AwsCliExecText;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<void> {
  const described = await input.awsCliJsonImpl<DescribeLogGroupsOutput>({
    region: input.region,
    args: ["logs", "describe-log-groups", "--log-group-name-prefix", input.logGroupName],
    stderr: input.stderr,
  });

  const exists = (described.logGroups ?? []).some((group) => group.logGroupName === input.logGroupName);
  if (exists) {
    return;
  }

  await input.awsCliExecImpl({
    region: input.region,
    args: ["logs", "create-log-group", "--log-group-name", input.logGroupName],
    stderr: input.stderr,
  });
}

export async function registerTaskDefinition(input: {
  region: string;
  names: DeploymentNames;
  imageUri: string;
  roleArn: string;
  deployConfig: AwsEcsDeployConfig;
  secretArn?: string;
  secretNames: string[];
  stderr?: Writable;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string> {
  const containerDefinitions = [
    {
      name: input.names.serviceName,
      image: input.imageUri,
      essential: true,
      portMappings: [
        {
          containerPort: input.deployConfig.containerPort,
          protocol: "tcp",
        },
      ],
      ...(input.secretArn && input.secretNames.length > 0
        ? { secrets: toSecretEnvRefs(input.secretArn, input.secretNames) }
        : {}),
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": input.names.logGroupName,
          "awslogs-region": input.region,
          "awslogs-stream-prefix": input.names.serviceName,
        },
      },
    },
  ];

  const registered = await input.awsCliJsonImpl<RegisterTaskDefinitionOutput>({
    region: input.region,
    args: [
      "ecs",
      "register-task-definition",
      "--family",
      input.names.taskFamily,
      "--requires-compatibilities",
      "FARGATE",
      "--network-mode",
      "awsvpc",
      "--cpu",
      input.deployConfig.cpu,
      "--memory",
      input.deployConfig.memory,
      "--execution-role-arn",
      input.roleArn,
      "--task-role-arn",
      input.roleArn,
      "--container-definitions",
      JSON.stringify(containerDefinitions),
    ],
    stderr: input.stderr,
  });

  const taskDefinitionArn = registered.taskDefinition?.taskDefinitionArn;
  if (!taskDefinitionArn) {
    throw new Error(`Failed to register task definition for ${input.names.taskFamily}.`);
  }

  return taskDefinitionArn;
}

async function createOrUpdateService(input: {
  region: string;
  names: DeploymentNames;
  taskDefinitionArn: string;
  subnetIds: string[];
  securityGroupId: string;
  desiredCount: number;
  existingStatus?: string;
  stderr?: Writable;
  awsCliExecImpl: AwsCliExecText;
}): Promise<void> {
  const networkConfiguration = JSON.stringify(
    toNetworkConfiguration(input.subnetIds, input.securityGroupId),
  );

  if (input.existingStatus && input.existingStatus !== "INACTIVE") {
    await input.awsCliExecImpl({
      region: input.region,
      args: [
        "ecs",
        "update-service",
        "--cluster",
        input.names.clusterName,
        "--service",
        input.names.serviceName,
        "--task-definition",
        input.taskDefinitionArn,
        "--desired-count",
        String(input.desiredCount),
        "--network-configuration",
        networkConfiguration,
        "--force-new-deployment",
      ],
      stderr: input.stderr,
    });
    return;
  }

  await input.awsCliExecImpl({
    region: input.region,
    args: [
      "ecs",
      "create-service",
      "--cluster",
      input.names.clusterName,
      "--service-name",
      input.names.serviceName,
      "--task-definition",
      input.taskDefinitionArn,
      "--launch-type",
      "FARGATE",
      "--desired-count",
      String(input.desiredCount),
      "--network-configuration",
      networkConfiguration,
    ],
    stderr: input.stderr,
  });
}

export async function ensureService(input: {
  region: string;
  names: DeploymentNames;
  taskDefinitionArn: string;
  subnetIds: string[];
  securityGroupId: string;
  desiredCount: number;
  stderr?: Writable;
  awsCliExecImpl: AwsCliExecText;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<void> {
  const described = await input.awsCliJsonImpl<DescribeServicesOutput>({
    region: input.region,
    args: [
      "ecs",
      "describe-services",
      "--cluster",
      input.names.clusterName,
      "--services",
      input.names.serviceName,
    ],
    stderr: input.stderr,
  });

  await createOrUpdateService({
    region: input.region,
    names: input.names,
    taskDefinitionArn: input.taskDefinitionArn,
    subnetIds: input.subnetIds,
    securityGroupId: input.securityGroupId,
    desiredCount: input.desiredCount,
    existingStatus: described.services[0]?.status,
    stderr: input.stderr,
    awsCliExecImpl: input.awsCliExecImpl,
  });

  await input.awsCliExecImpl({
    region: input.region,
    args: [
      "ecs",
      "wait",
      "services-stable",
      "--cluster",
      input.names.clusterName,
      "--services",
      input.names.serviceName,
    ],
    stderr: input.stderr,
  });
}

function findNetworkInterfaceId(taskOutput: DescribeTasksOutput): string | undefined {
  const details = taskOutput.tasks?.[0]?.attachments?.flatMap((attachment) => attachment.details ?? []) ?? [];
  return details.find((detail) => detail.name === "networkInterfaceId")?.value;
}

export async function resolveServicePublicIp(input: {
  region: string;
  names: DeploymentNames;
  stderr?: Writable;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string | undefined> {
  const listed = await input.awsCliJsonImpl<ListTasksOutput>({
    region: input.region,
    args: [
      "ecs",
      "list-tasks",
      "--cluster",
      input.names.clusterName,
      "--service-name",
      input.names.serviceName,
      "--desired-status",
      "RUNNING",
    ],
    stderr: input.stderr,
  });
  const taskArn = listed.taskArns?.[0];

  if (!taskArn) {
    return undefined;
  }

  const taskDetails = await input.awsCliJsonImpl<DescribeTasksOutput>({
    region: input.region,
    args: [
      "ecs",
      "describe-tasks",
      "--cluster",
      input.names.clusterName,
      "--tasks",
      taskArn,
    ],
    stderr: input.stderr,
  });
  const networkInterfaceId = findNetworkInterfaceId(taskDetails);

  if (!networkInterfaceId) {
    return undefined;
  }

  const networkInterfaces = await input.awsCliJsonImpl<DescribeNetworkInterfacesOutput>({
    region: input.region,
    args: [
      "ec2",
      "describe-network-interfaces",
      "--network-interface-ids",
      networkInterfaceId,
    ],
    stderr: input.stderr,
  });

  return networkInterfaces.NetworkInterfaces?.[0]?.Association?.PublicIp;
}
