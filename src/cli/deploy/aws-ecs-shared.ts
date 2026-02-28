import type { Writable } from "node:stream";

import type { AwsCliExecOptions } from "./aws-cli.js";

export const EXECUTION_ROLE_NAME = "agent-bundle-ecs-execution-role";
export const EXECUTION_POLICY_ARN = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy";

export type AwsCliExecJson = <T>(options: AwsCliExecOptions) => Promise<T>;

export type AwsCliExecText = (options: AwsCliExecOptions) => Promise<{ stdout: string }>;

export type AwsCliExecWithStatus = (
  options: AwsCliExecOptions,
) => Promise<{ stdout: string; exitCode: number; stderr: string }>;

export type AwsEcsDeployConfig = {
  cpu: string;
  memory: string;
  desiredCount: number;
  containerPort: number;
};

export type DeployToAwsEcsOptions = {
  region: string;
  bundleName: string;
  imageUri: string;
  secrets: Record<string, string>;
  deployConfig: AwsEcsDeployConfig;
  stdout?: Writable;
  stderr?: Writable;
  awsCliExecImpl?: AwsCliExecWithStatus;
  awsCliJsonImpl?: AwsCliExecJson;
};

export type DeployToAwsEcsResult = {
  clusterName: string;
  serviceName: string;
  taskDefinitionArn: string;
  securityGroupId: string;
  secretArn?: string;
  publicIp?: string;
};

export type DeploymentNames = {
  prefix: string;
  clusterName: string;
  serviceName: string;
  taskFamily: string;
  securityGroupName: string;
  secretName: string;
  logGroupName: string;
};

export function createAwsDeploymentNames(bundleName: string): DeploymentNames {
  const prefix = `agent-bundle-${bundleName}`;

  return {
    prefix,
    clusterName: prefix,
    serviceName: prefix,
    taskFamily: prefix,
    securityGroupName: prefix,
    secretName: prefix,
    logGroupName: `/ecs/${prefix}`,
  };
}

export function toNetworkConfiguration(subnetIds: string[], securityGroupId: string): {
  awsvpcConfiguration: {
    subnets: string[];
    securityGroups: string[];
    assignPublicIp: "ENABLED";
  };
} {
  return {
    awsvpcConfiguration: {
      subnets: subnetIds,
      securityGroups: [securityGroupId],
      assignPublicIp: "ENABLED",
    },
  };
}

export function toSecretEnvRefs(
  secretArn: string,
  secretNames: string[],
): Array<{ name: string; valueFrom: string }> {
  return secretNames.map((name) => ({
    name,
    valueFrom: `${secretArn}:${name}::`,
  }));
}
