import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import { teardownAwsResources } from "../aws-teardown.js";
import type { AwsCliExecOptions } from "../aws-cli.js";

function matches(options: AwsCliExecOptions, expectedPrefix: string[]): boolean {
  return expectedPrefix.every((part, index) => options.args[index] === part);
}

it("teardownAwsResources performs all steps with best-effort warnings", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stderrText = "";

  stderr.on("data", (chunk: Buffer | string) => {
    stderrText += chunk.toString();
  });

  const awsCliJsonMock = vi.fn<(<T>(options: AwsCliExecOptions) => Promise<T>)>(async (options) => {
    if (matches(options, ["ecs", "describe-services"])) {
      return { services: [{ status: "ACTIVE" }] } as T;
    }
    if (matches(options, ["ecs", "list-task-definitions"])) {
      return { taskDefinitionArns: ["arn:task-def:1"] } as T;
    }
    if (matches(options, ["ec2", "describe-security-groups"])) {
      return { SecurityGroups: [{ GroupId: "sg-1" }] } as T;
    }

    throw new Error(`Unexpected awsCliJson call: ${options.args.join(" ")}`);
  });

  const awsCliExecMock = vi.fn(async (options: AwsCliExecOptions) => {
    if (matches(options, ["secretsmanager", "delete-secret"])) {
      throw new Error("secret delete failed");
    }

    return { stdout: "" };
  });

  await teardownAwsResources({
    region: "us-east-1",
    bundleName: "code-formatter",
    awsCliJsonImpl: awsCliJsonMock,
    awsCliExecImpl: awsCliExecMock,
    stdout,
    stderr,
  });

  expect(awsCliExecMock).toHaveBeenCalledWith(
    expect.objectContaining({ args: ["ecs", "delete-cluster", "--cluster", "agent-bundle-code-formatter"] }),
  );
  expect(awsCliExecMock).toHaveBeenCalledWith(
    expect.objectContaining({ args: ["ecr", "delete-repository", "--repository-name", "agent-bundle-code-formatter", "--force"] }),
  );
  expect(awsCliExecMock).toHaveBeenCalledWith(
    expect.objectContaining({ args: ["logs", "delete-log-group", "--log-group-name", "/ecs/agent-bundle-code-formatter"] }),
  );
  expect(stderrText).toContain("warning: Deleting secret agent-bundle-code-formatter failed");
});

it("teardownAwsResources skips absent service, task definitions, and security group", async () => {
  const awsCliJsonMock = vi.fn<(<T>(options: AwsCliExecOptions) => Promise<T>)>(async (options) => {
    if (matches(options, ["ecs", "describe-services"])) {
      return { services: [{ status: "INACTIVE" }] } as T;
    }
    if (matches(options, ["ecs", "list-task-definitions"])) {
      return { taskDefinitionArns: [] } as T;
    }
    if (matches(options, ["ec2", "describe-security-groups"])) {
      return { SecurityGroups: [] } as T;
    }

    throw new Error(`Unexpected awsCliJson call: ${options.args.join(" ")}`);
  });

  const awsCliExecMock = vi.fn(async () => {
    return { stdout: "" };
  });

  await teardownAwsResources({
    region: "us-east-1",
    bundleName: "code-formatter",
    awsCliJsonImpl: awsCliJsonMock,
    awsCliExecImpl: awsCliExecMock,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });

  expect(awsCliExecMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ args: ["ecs", "delete-service", "--cluster", "agent-bundle-code-formatter", "--service", "agent-bundle-code-formatter", "--force"] }),
  );
  expect(awsCliExecMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ args: ["ec2", "delete-security-group", "--group-id", "sg-1"] }),
  );
});
