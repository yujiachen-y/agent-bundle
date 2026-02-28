import type { Writable } from "node:stream";

import { errorHasCode } from "./aws-cli.js";
import type { AwsCliExecOptions } from "./aws-cli.js";
import {
  type AwsCliExecJson,
  type AwsCliExecWithStatus,
} from "./aws-ecs-shared.js";

type DescribeClustersOutput = {
  clusters: Array<{
    status?: string;
  }>;
};

type CreateClusterOutput = {
  cluster?: {
    clusterName?: string;
  };
};

type CreateOrUpdateSecretOutput = {
  ARN?: string;
};

type DescribeVpcsOutput = {
  Vpcs: Array<{
    VpcId: string;
  }>;
};

type DescribeSubnetsOutput = {
  Subnets: Array<{
    SubnetId: string;
  }>;
};

type DescribeSecurityGroupsOutput = {
  SecurityGroups: Array<{
    GroupId: string;
  }>;
};

type CreateSecurityGroupOutput = {
  GroupId?: string;
};

export async function ensureCluster(input: {
  region: string;
  clusterName: string;
  stderr?: Writable;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<void> {
  const described = await input.awsCliJsonImpl<DescribeClustersOutput>({
    region: input.region,
    args: ["ecs", "describe-clusters", "--clusters", input.clusterName],
    stderr: input.stderr,
  });

  const existing = described.clusters[0];
  if (existing?.status && existing.status !== "INACTIVE") {
    return;
  }

  const created = await input.awsCliJsonImpl<CreateClusterOutput>({
    region: input.region,
    args: ["ecs", "create-cluster", "--cluster-name", input.clusterName],
    stderr: input.stderr,
  });

  if (!created.cluster?.clusterName) {
    throw new Error(`Failed to create ECS cluster ${input.clusterName}.`);
  }
}

async function createOrUpdateSecret(input: {
  region: string;
  secretName: string;
  secretString: string;
  command: "create-secret" | "update-secret";
  stderr?: Writable;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string | undefined> {
  const secretIdFlag = input.command === "create-secret" ? "--name" : "--secret-id";
  const result = await input.awsCliJsonImpl<CreateOrUpdateSecretOutput>({
    region: input.region,
    args: [
      "secretsmanager",
      input.command,
      secretIdFlag,
      input.secretName,
      "--secret-string",
      input.secretString,
    ],
    stderr: input.stderr,
  });

  return result.ARN;
}

export async function upsertSecret(input: {
  region: string;
  secretName: string;
  secrets: Record<string, string>;
  stderr?: Writable;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string | undefined> {
  if (Object.keys(input.secrets).length === 0) {
    return undefined;
  }

  const secretString = JSON.stringify(input.secrets);

  try {
    return await createOrUpdateSecret({
      region: input.region,
      secretName: input.secretName,
      secretString,
      command: "create-secret",
      stderr: input.stderr,
      awsCliJsonImpl: input.awsCliJsonImpl,
    });
  } catch (error) {
    if (!errorHasCode(error, "ResourceExistsException")) {
      throw error;
    }

    return await createOrUpdateSecret({
      region: input.region,
      secretName: input.secretName,
      secretString,
      command: "update-secret",
      stderr: input.stderr,
      awsCliJsonImpl: input.awsCliJsonImpl,
    });
  }
}

export async function resolveDefaultVpcId(input: {
  region: string;
  stderr?: Writable;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string> {
  const described = await input.awsCliJsonImpl<DescribeVpcsOutput>({
    region: input.region,
    args: ["ec2", "describe-vpcs", "--filters", "Name=isDefault,Values=true"],
    stderr: input.stderr,
  });

  const vpcId = described.Vpcs[0]?.VpcId;
  if (!vpcId) {
    throw new Error("Could not find a default VPC in this AWS account/region.");
  }

  return vpcId;
}

export async function resolveSubnetIds(input: {
  region: string;
  vpcId: string;
  stderr?: Writable;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string[]> {
  const described = await input.awsCliJsonImpl<DescribeSubnetsOutput>({
    region: input.region,
    args: ["ec2", "describe-subnets", "--filters", `Name=vpc-id,Values=${input.vpcId}`],
    stderr: input.stderr,
  });
  const subnetIds = described.Subnets.map((subnet) => subnet.SubnetId).filter((id) => id.length > 0);

  if (subnetIds.length === 0) {
    throw new Error(`No subnets were found in VPC ${input.vpcId}.`);
  }

  return subnetIds;
}

async function createSecurityGroup(input: {
  region: string;
  groupName: string;
  vpcId: string;
  stderr?: Writable;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string> {
  const created = await input.awsCliJsonImpl<CreateSecurityGroupOutput>({
    region: input.region,
    args: [
      "ec2",
      "create-security-group",
      "--group-name",
      input.groupName,
      "--description",
      "agent-bundle ECS access",
      "--vpc-id",
      input.vpcId,
    ],
    stderr: input.stderr,
  });

  if (!created.GroupId) {
    throw new Error(`Failed to create security group ${input.groupName}.`);
  }

  return created.GroupId;
}

async function authorizeIngress(input: {
  region: string;
  groupId: string;
  containerPort: number;
  stderr?: Writable;
  awsCliExecImpl: AwsCliExecWithStatus;
}): Promise<void> {
  const ingressResult = await input.awsCliExecImpl({
    region: input.region,
    args: [
      "ec2",
      "authorize-security-group-ingress",
      "--group-id",
      input.groupId,
      "--protocol",
      "tcp",
      "--port",
      String(input.containerPort),
      "--cidr",
      "0.0.0.0/0",
    ],
    stderr: input.stderr,
    allowNonZeroExit: true,
  });

  if (ingressResult.exitCode !== 0 && !ingressResult.stderr.includes("InvalidPermission.Duplicate")) {
    throw new Error(ingressResult.stderr.trim() || "Failed to authorize security group ingress.");
  }
}

export async function ensureSecurityGroup(input: {
  region: string;
  vpcId: string;
  groupName: string;
  containerPort: number;
  stderr?: Writable;
  awsCliExecImpl: AwsCliExecWithStatus;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string> {
  const described = await input.awsCliJsonImpl<DescribeSecurityGroupsOutput>({
    region: input.region,
    args: [
      "ec2",
      "describe-security-groups",
      "--filters",
      `Name=group-name,Values=${input.groupName}`,
      `Name=vpc-id,Values=${input.vpcId}`,
    ],
    stderr: input.stderr,
  });

  const groupId = described.SecurityGroups[0]?.GroupId
    ?? await createSecurityGroup({
      region: input.region,
      groupName: input.groupName,
      vpcId: input.vpcId,
      stderr: input.stderr,
      awsCliJsonImpl: input.awsCliJsonImpl,
    });

  await authorizeIngress({
    region: input.region,
    groupId,
    containerPort: input.containerPort,
    stderr: input.stderr,
    awsCliExecImpl: input.awsCliExecImpl,
  });

  return groupId;
}

export function toAwsCliTextExecutor(execImpl: AwsCliExecWithStatus): (options: AwsCliExecOptions) => Promise<{ stdout: string }> {
  return async (options: AwsCliExecOptions) => {
    const result = await execImpl(options);
    return {
      stdout: result.stdout,
    };
  };
}
