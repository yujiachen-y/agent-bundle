import type { Writable } from "node:stream";

import { errorHasCode } from "./aws-cli.js";
import {
  EXECUTION_POLICY_ARN,
  EXECUTION_ROLE_NAME,
  type AwsCliExecJson,
  type AwsCliExecText,
} from "./aws-ecs-shared.js";

type GetRoleOutput = {
  Role?: {
    Arn?: string;
  };
};

type CreateRoleOutput = {
  Role?: {
    Arn?: string;
  };
};

function toAssumeRolePolicy(): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          Service: "ecs-tasks.amazonaws.com",
        },
        Action: "sts:AssumeRole",
      },
    ],
  });
}

async function resolveExecutionRoleArn(input: {
  region: string;
  stderr?: Writable;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string> {
  try {
    const existing = await input.awsCliJsonImpl<GetRoleOutput>({
      region: input.region,
      args: ["iam", "get-role", "--role-name", EXECUTION_ROLE_NAME],
      stderr: input.stderr,
    });
    const arn = existing.Role?.Arn;

    if (!arn) {
      throw new Error(`IAM role ${EXECUTION_ROLE_NAME} exists but has no ARN.`);
    }

    return arn;
  } catch (error) {
    if (!errorHasCode(error, "NoSuchEntity")) {
      throw error;
    }

    const created = await input.awsCliJsonImpl<CreateRoleOutput>({
      region: input.region,
      args: [
        "iam",
        "create-role",
        "--role-name",
        EXECUTION_ROLE_NAME,
        "--assume-role-policy-document",
        toAssumeRolePolicy(),
      ],
      stderr: input.stderr,
    });
    const createdArn = created.Role?.Arn;

    if (!createdArn) {
      throw new Error(`Failed to create IAM role ${EXECUTION_ROLE_NAME}.`);
    }

    return createdArn;
  }
}

async function attachExecutionPolicy(input: {
  region: string;
  stderr?: Writable;
  awsCliExecImpl: AwsCliExecText;
}): Promise<void> {
  await input.awsCliExecImpl({
    region: input.region,
    args: [
      "iam",
      "attach-role-policy",
      "--role-name",
      EXECUTION_ROLE_NAME,
      "--policy-arn",
      EXECUTION_POLICY_ARN,
    ],
    stderr: input.stderr,
  });
}

async function upsertSecretsPolicy(input: {
  region: string;
  secretArn: string;
  stderr?: Writable;
  awsCliExecImpl: AwsCliExecText;
}): Promise<void> {
  const secretPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: [input.secretArn],
      },
    ],
  });

  await input.awsCliExecImpl({
    region: input.region,
    args: [
      "iam",
      "put-role-policy",
      "--role-name",
      EXECUTION_ROLE_NAME,
      "--policy-name",
      "agent-bundle-secrets-access",
      "--policy-document",
      secretPolicy,
    ],
    stderr: input.stderr,
  });
}

export async function ensureExecutionRole(input: {
  region: string;
  secretArn?: string;
  stderr?: Writable;
  awsCliExecImpl: AwsCliExecText;
  awsCliJsonImpl: AwsCliExecJson;
}): Promise<string> {
  const roleArn = await resolveExecutionRoleArn({
    region: input.region,
    stderr: input.stderr,
    awsCliJsonImpl: input.awsCliJsonImpl,
  });

  await attachExecutionPolicy({
    region: input.region,
    stderr: input.stderr,
    awsCliExecImpl: input.awsCliExecImpl,
  });

  if (input.secretArn) {
    await upsertSecretsPolicy({
      region: input.region,
      secretArn: input.secretArn,
      stderr: input.stderr,
      awsCliExecImpl: input.awsCliExecImpl,
    });
  }

  return roleArn;
}
