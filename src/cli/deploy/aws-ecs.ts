import type { Writable } from "node:stream";

import {
  awsCliExec,
  awsCliJson,
} from "./aws-cli.js";
import {
  ensureCluster,
  ensureSecurityGroup,
  resolveDefaultVpcId,
  resolveSubnetIds,
  toAwsCliTextExecutor,
  upsertSecret,
} from "./aws-ecs-infra.js";
import { ensureExecutionRole } from "./aws-ecs-role.js";
import {
  ensureLogGroup,
  ensureService,
  registerTaskDefinition,
  resolveServicePublicIp,
} from "./aws-ecs-service.js";
import {
  EXECUTION_ROLE_NAME,
  createAwsDeploymentNames,
  type DeployToAwsEcsOptions,
  type DeployToAwsEcsResult,
  type AwsCliExecWithStatus,
  type AwsCliExecJson,
} from "./aws-ecs-shared.js";

export {
  createAwsDeploymentNames,
  type AwsEcsDeployConfig,
  type DeployToAwsEcsOptions,
  type DeployToAwsEcsResult,
} from "./aws-ecs-shared.js";

type PreparedInfrastructure = {
  vpcId: string;
  subnetIds: string[];
  securityGroupId: string;
  secretArn?: string;
};

async function prepareInfrastructure(input: {
  region: string;
  names: ReturnType<typeof createAwsDeploymentNames>;
  containerPort: number;
  secrets: Record<string, string>;
  stderr?: Writable;
  stdout: Writable;
  awsCliExecImpl: AwsCliExecWithStatus;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<PreparedInfrastructure> {
  input.stdout.write(`[deploy/aws] Upserting secret ${input.names.secretName}\n`);
  const secretArn = await upsertSecret({
    region: input.region,
    secretName: input.names.secretName,
    secrets: input.secrets,
    stderr: input.stderr,
    awsCliJsonImpl: input.awsCliJsonImpl,
  });

  input.stdout.write("[deploy/aws] Discovering default VPC and subnets\n");
  const vpcId = await resolveDefaultVpcId({
    region: input.region,
    stderr: input.stderr,
    awsCliJsonImpl: input.awsCliJsonImpl,
  });
  const subnetIds = await resolveSubnetIds({
    region: input.region,
    vpcId,
    stderr: input.stderr,
    awsCliJsonImpl: input.awsCliJsonImpl,
  });

  input.stdout.write(`[deploy/aws] Ensuring security group ${input.names.securityGroupName}\n`);
  const securityGroupId = await ensureSecurityGroup({
    region: input.region,
    vpcId,
    groupName: input.names.securityGroupName,
    containerPort: input.containerPort,
    stderr: input.stderr,
    awsCliExecImpl: input.awsCliExecImpl,
    awsCliJsonImpl: input.awsCliJsonImpl,
  });

  return {
    vpcId,
    subnetIds,
    securityGroupId,
    secretArn,
  };
}

async function deployService(input: {
  region: string;
  names: ReturnType<typeof createAwsDeploymentNames>;
  imageUri: string;
  deployConfig: DeployToAwsEcsOptions["deployConfig"];
  secrets: Record<string, string>;
  secretArn?: string;
  subnetIds: string[];
  securityGroupId: string;
  stderr?: Writable;
  stdout: Writable;
  awsCliExecTextImpl: (options: Parameters<AwsCliExecWithStatus>[0]) => Promise<{ stdout: string }>;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string> {
  input.stdout.write(`[deploy/aws] Ensuring IAM role ${EXECUTION_ROLE_NAME}\n`);
  const roleArn = await ensureExecutionRole({
    region: input.region,
    secretArn: input.secretArn,
    stderr: input.stderr,
    awsCliExecImpl: input.awsCliExecTextImpl,
    awsCliJsonImpl: input.awsCliJsonImpl,
  });

  input.stdout.write(`[deploy/aws] Ensuring CloudWatch log group ${input.names.logGroupName}\n`);
  await ensureLogGroup({
    region: input.region,
    logGroupName: input.names.logGroupName,
    stderr: input.stderr,
    awsCliExecImpl: input.awsCliExecTextImpl,
    awsCliJsonImpl: input.awsCliJsonImpl,
  });

  input.stdout.write(`[deploy/aws] Registering task definition ${input.names.taskFamily}\n`);
  const taskDefinitionArn = await registerTaskDefinition({
    region: input.region,
    names: input.names,
    imageUri: input.imageUri,
    roleArn,
    deployConfig: input.deployConfig,
    secretArn: input.secretArn,
    secretNames: Object.keys(input.secrets),
    stderr: input.stderr,
    awsCliJsonImpl: input.awsCliJsonImpl,
  });

  input.stdout.write(`[deploy/aws] Creating or updating ECS service ${input.names.serviceName}\n`);
  await ensureService({
    region: input.region,
    names: input.names,
    taskDefinitionArn,
    subnetIds: input.subnetIds,
    securityGroupId: input.securityGroupId,
    desiredCount: input.deployConfig.desiredCount,
    stderr: input.stderr,
    awsCliExecImpl: input.awsCliExecTextImpl,
    awsCliJsonImpl: input.awsCliJsonImpl,
  });

  return taskDefinitionArn;
}

export async function deployToAwsEcs(options: DeployToAwsEcsOptions): Promise<DeployToAwsEcsResult> {
  const stdout = options.stdout ?? process.stdout;
  const awsCliExecImpl = options.awsCliExecImpl ?? awsCliExec;
  const awsCliJsonImpl = options.awsCliJsonImpl ?? awsCliJson;
  const awsCliExecTextImpl = toAwsCliTextExecutor(awsCliExecImpl);
  const names = createAwsDeploymentNames(options.bundleName);

  stdout.write(`[deploy/aws] Ensuring ECS cluster ${names.clusterName}\n`);
  await ensureCluster({
    region: options.region,
    clusterName: names.clusterName,
    stderr: options.stderr,
    awsCliJsonImpl,
  });

  const infrastructure = await prepareInfrastructure({
    region: options.region,
    names,
    containerPort: options.deployConfig.containerPort,
    secrets: options.secrets,
    stderr: options.stderr,
    stdout,
    awsCliExecImpl,
    awsCliJsonImpl,
  });

  const taskDefinitionArn = await deployService({
    region: options.region,
    names,
    imageUri: options.imageUri,
    deployConfig: options.deployConfig,
    secrets: options.secrets,
    secretArn: infrastructure.secretArn,
    subnetIds: infrastructure.subnetIds,
    securityGroupId: infrastructure.securityGroupId,
    stderr: options.stderr,
    stdout,
    awsCliExecTextImpl,
    awsCliJsonImpl,
  });

  stdout.write("[deploy/aws] Resolving service public IP\n");
  const publicIp = await resolveServicePublicIp({
    region: options.region,
    names,
    stderr: options.stderr,
    awsCliJsonImpl,
  });

  return {
    clusterName: names.clusterName,
    serviceName: names.serviceName,
    taskDefinitionArn,
    securityGroupId: infrastructure.securityGroupId,
    secretArn: infrastructure.secretArn,
    publicIp,
  };
}
