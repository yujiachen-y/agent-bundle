import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import { deployToAwsEcs } from "../aws-ecs.js";
import type { AwsCliExecOptions } from "../aws-cli.js";

type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function okExecResult(): ExecResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
  };
}

function matches(options: AwsCliExecOptions, expectedPrefix: string[]): boolean {
  return expectedPrefix.every((part, index) => options.args[index] === part);
}

function findCall(
  calls: Array<[AwsCliExecOptions]>,
  expectedPrefix: string[],
): AwsCliExecOptions | undefined {
  return calls.map((entry) => entry[0]).find((call) => matches(call, expectedPrefix));
}

function createAwsCliJsonCreateScenarioMock(): ReturnType<typeof vi.fn<(<T>(options: AwsCliExecOptions) => Promise<T>)>> {
  return vi.fn<(<T>(options: AwsCliExecOptions) => Promise<T>)>(async (options) => {
    if (matches(options, ["ecs", "describe-clusters"])) {
      return { clusters: [{ status: "INACTIVE" }] } as T;
    }
    if (matches(options, ["ecs", "create-cluster"])) {
      return { cluster: { clusterName: "agent-bundle-code-formatter" } } as T;
    }
    if (matches(options, ["secretsmanager", "create-secret"])) {
      return { ARN: "arn:aws:secretsmanager:us-east-1:123:secret:agent-bundle-code-formatter" } as T;
    }
    if (matches(options, ["ec2", "describe-vpcs"])) {
      return { Vpcs: [{ VpcId: "vpc-1" }] } as T;
    }
    if (matches(options, ["ec2", "describe-subnets"])) {
      return { Subnets: [{ SubnetId: "subnet-a" }, { SubnetId: "subnet-b" }] } as T;
    }
    if (matches(options, ["ec2", "describe-security-groups"])) {
      return { SecurityGroups: [] } as T;
    }
    if (matches(options, ["ec2", "create-security-group"])) {
      return { GroupId: "sg-1" } as T;
    }
    if (matches(options, ["iam", "get-role"])) {
      throw new Error("NoSuchEntity");
    }
    if (matches(options, ["iam", "create-role"])) {
      return { Role: { Arn: "arn:aws:iam::123:role/agent-bundle-ecs-execution-role" } } as T;
    }
    if (matches(options, ["logs", "describe-log-groups"])) {
      return { logGroups: [] } as T;
    }
    if (matches(options, ["ecs", "register-task-definition"])) {
      return { taskDefinition: { taskDefinitionArn: "arn:task-def:1" } } as T;
    }
    if (matches(options, ["ecs", "describe-services"])) {
      return { services: [{ status: "INACTIVE" }] } as T;
    }
    if (matches(options, ["ecs", "list-tasks"])) {
      return { taskArns: ["arn:task/running"] } as T;
    }
    if (matches(options, ["ecs", "describe-tasks"])) {
      return {
        tasks: [{ attachments: [{ details: [{ name: "networkInterfaceId", value: "eni-1" }] }] }],
      } as T;
    }
    if (matches(options, ["ec2", "describe-network-interfaces"])) {
      return { NetworkInterfaces: [{ Association: { PublicIp: "1.2.3.4" } }] } as T;
    }

    throw new Error(`Unexpected awsCliJson call: ${options.args.join(" ")}`);
  });
}

function createAwsCliExecMockForCreateScenario(): ReturnType<typeof vi.fn<(options: AwsCliExecOptions) => Promise<ExecResult>>> {
  return vi.fn(async () => {
    return okExecResult();
  });
}

function assertCreateScenarioTaskDefinition(
  calls: Array<[AwsCliExecOptions]>,
): void {
  const registerCall = findCall(calls, ["ecs", "register-task-definition"]);
  expect(registerCall).toBeDefined();
  const containerDefinitionsFlagIndex = registerCall!.args.indexOf("--container-definitions");
  const containerDefinitions = JSON.parse(registerCall!.args[containerDefinitionsFlagIndex + 1] ?? "[]") as Array<{
    secrets?: Array<{ name: string; valueFrom: string }>;
  }>;
  expect(containerDefinitions[0]?.secrets?.[0]).toEqual({
    name: "ANTHROPIC_API_KEY",
    valueFrom: "arn:aws:secretsmanager:us-east-1:123:secret:agent-bundle-code-formatter:ANTHROPIC_API_KEY::",
  });
}

type UpdateScenarioState = {
  createSecretAttempted: boolean;
};

function createAwsCliJsonUpdateScenarioMock(
  state: UpdateScenarioState,
): ReturnType<typeof vi.fn<(<T>(options: AwsCliExecOptions) => Promise<T>)>> {
  return vi.fn<(<T>(options: AwsCliExecOptions) => Promise<T>)>(async (options) => {
    if (matches(options, ["ecs", "describe-clusters"])) {
      return { clusters: [{ status: "ACTIVE" }] } as T;
    }
    if (matches(options, ["secretsmanager", "create-secret"])) {
      state.createSecretAttempted = true;
      throw new Error("ResourceExistsException");
    }
    if (matches(options, ["secretsmanager", "update-secret"])) {
      return { ARN: "arn:aws:secretsmanager:us-east-1:123:secret:agent-bundle-code-formatter" } as T;
    }
    if (matches(options, ["ec2", "describe-vpcs"])) {
      return { Vpcs: [{ VpcId: "vpc-1" }] } as T;
    }
    if (matches(options, ["ec2", "describe-subnets"])) {
      return { Subnets: [{ SubnetId: "subnet-a" }] } as T;
    }
    if (matches(options, ["ec2", "describe-security-groups"])) {
      return { SecurityGroups: [{ GroupId: "sg-existing" }] } as T;
    }
    if (matches(options, ["iam", "get-role"])) {
      return { Role: { Arn: "arn:aws:iam::123:role/agent-bundle-ecs-execution-role" } } as T;
    }
    if (matches(options, ["logs", "describe-log-groups"])) {
      return { logGroups: [{ logGroupName: "/ecs/agent-bundle-code-formatter" }] } as T;
    }
    if (matches(options, ["ecs", "register-task-definition"])) {
      return { taskDefinition: { taskDefinitionArn: "arn:task-def:2" } } as T;
    }
    if (matches(options, ["ecs", "describe-services"])) {
      return { services: [{ status: "ACTIVE" }] } as T;
    }
    if (matches(options, ["ecs", "list-tasks"])) {
      return { taskArns: [] } as T;
    }

    throw new Error(`Unexpected awsCliJson call: ${options.args.join(" ")}`);
  });
}

function createAwsCliExecMockForUpdateScenario(): ReturnType<typeof vi.fn<(options: AwsCliExecOptions) => Promise<ExecResult>>> {
  return vi.fn(async (options: AwsCliExecOptions): Promise<ExecResult> => {
    if (matches(options, ["ec2", "authorize-security-group-ingress"])) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "InvalidPermission.Duplicate",
      };
    }

    return okExecResult();
  });
}

it("deployToAwsEcs creates missing resources and returns public IP", async () => {
  const awsCliJsonMock = createAwsCliJsonCreateScenarioMock();
  const awsCliExecMock = createAwsCliExecMockForCreateScenario();

  const result = await deployToAwsEcs({
    region: "us-east-1",
    bundleName: "code-formatter",
    imageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-bundle-code-formatter:latest",
    secrets: { ANTHROPIC_API_KEY: "abc123" },
    deployConfig: {
      cpu: "512",
      memory: "1024",
      desiredCount: 1,
      containerPort: 3000,
    },
    awsCliExecImpl: awsCliExecMock,
    awsCliJsonImpl: awsCliJsonMock,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });

  assertCreateScenarioTaskDefinition(awsCliJsonMock.mock.calls as Array<[AwsCliExecOptions]>);
  expect(findCall(awsCliJsonMock.mock.calls as Array<[AwsCliExecOptions]>, ["iam", "create-role"]))
    .toBeDefined();
  expect(findCall(awsCliExecMock.mock.calls as Array<[AwsCliExecOptions]>, ["ecs", "create-service"]))
    .toBeDefined();
  expect(result).toEqual({
    clusterName: "agent-bundle-code-formatter",
    serviceName: "agent-bundle-code-formatter",
    taskDefinitionArn: "arn:task-def:1",
    securityGroupId: "sg-1",
    secretArn: "arn:aws:secretsmanager:us-east-1:123:secret:agent-bundle-code-formatter",
    publicIp: "1.2.3.4",
  });
});

it("deployToAwsEcs updates existing resources and tolerates duplicate ingress rule", async () => {
  const state: UpdateScenarioState = {
    createSecretAttempted: false,
  };
  const awsCliJsonMock = createAwsCliJsonUpdateScenarioMock(state);
  const awsCliExecMock = createAwsCliExecMockForUpdateScenario();

  const result = await deployToAwsEcs({
    region: "us-east-1",
    bundleName: "code-formatter",
    imageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-bundle-code-formatter:latest",
    secrets: { ANTHROPIC_API_KEY: "abc123" },
    deployConfig: {
      cpu: "256",
      memory: "512",
      desiredCount: 2,
      containerPort: 3000,
    },
    awsCliExecImpl: awsCliExecMock,
    awsCliJsonImpl: awsCliJsonMock,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });

  expect(state.createSecretAttempted).toBe(true);
  expect(findCall(awsCliJsonMock.mock.calls as Array<[AwsCliExecOptions]>, ["secretsmanager", "update-secret"]))
    .toBeDefined();
  expect(findCall(awsCliJsonMock.mock.calls as Array<[AwsCliExecOptions]>, ["iam", "create-role"]))
    .toBeUndefined();
  expect(findCall(awsCliExecMock.mock.calls as Array<[AwsCliExecOptions]>, ["ecs", "update-service"]))
    .toBeDefined();
  expect(findCall(awsCliExecMock.mock.calls as Array<[AwsCliExecOptions]>, ["ecs", "create-service"]))
    .toBeUndefined();
  expect(findCall(awsCliExecMock.mock.calls as Array<[AwsCliExecOptions]>, ["logs", "create-log-group"]))
    .toBeUndefined();
  expect(result.publicIp).toBeUndefined();
  expect(result.securityGroupId).toBe("sg-existing");
});
