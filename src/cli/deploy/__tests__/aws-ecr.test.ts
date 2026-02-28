import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import { pushImageToEcr } from "../aws-ecr.js";
import type { AwsCliExecOptions, CommandRunner } from "../aws-cli.js";

it("pushImageToEcr uses existing repository and pushes tagged image", async () => {
  const awsCliJsonMock = vi
    .fn<(<T>(options: AwsCliExecOptions) => Promise<T>)>()
    .mockResolvedValue({
      repositories: [
        {
          repositoryName: "agent-bundle-code-formatter",
          repositoryUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-bundle-code-formatter",
        },
      ],
    } as never);
  const awsCliExecMock = vi
    .fn<((options: AwsCliExecOptions) => Promise<{ stdout: string }>)>()
    .mockResolvedValue({ stdout: "token\n" });
  const runCommandMock = vi
    .fn<CommandRunner>()
    .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

  const result = await pushImageToEcr({
    region: "us-east-1",
    bundleName: "code-formatter",
    localImageRef: "agent-bundle/execd:latest",
    awsCliJsonImpl: awsCliJsonMock,
    awsCliExecImpl: awsCliExecMock,
    runCommandImpl: runCommandMock,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });

  expect(result.repositoryName).toBe("agent-bundle-code-formatter");
  expect(result.imageUri).toBe(
    "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-bundle-code-formatter:latest",
  );
  expect(awsCliExecMock).toHaveBeenCalledWith(
    expect.objectContaining({
      args: ["ecr", "get-login-password"],
      outputJson: false,
    }),
  );
  expect(runCommandMock).toHaveBeenCalledWith(
    "docker",
    [
      "login",
      "--username",
      "AWS",
      "--password-stdin",
      "123456789012.dkr.ecr.us-east-1.amazonaws.com",
    ],
    expect.objectContaining({ input: "token\n" }),
  );
  expect(runCommandMock).toHaveBeenCalledWith(
    "docker",
    [
      "tag",
      "agent-bundle/execd:latest",
      "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-bundle-code-formatter:latest",
    ],
    expect.any(Object),
  );
  expect(runCommandMock).toHaveBeenCalledWith(
    "docker",
    ["push", "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-bundle-code-formatter:latest"],
    expect.any(Object),
  );
});

it("pushImageToEcr creates repository when describe call reports not found", async () => {
  const awsCliJsonMock = vi
    .fn<(<T>(options: AwsCliExecOptions) => Promise<T>)>()
    .mockRejectedValueOnce(new Error("RepositoryNotFoundException"))
    .mockResolvedValueOnce({
      repository: {
        repositoryName: "agent-bundle-code-formatter",
        repositoryUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-bundle-code-formatter",
      },
    } as never);
  const awsCliExecMock = vi
    .fn<((options: AwsCliExecOptions) => Promise<{ stdout: string }>)>()
    .mockResolvedValue({ stdout: "token\n" });
  const runCommandMock = vi
    .fn<CommandRunner>()
    .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

  await pushImageToEcr({
    region: "us-east-1",
    bundleName: "code-formatter",
    localImageRef: "agent-bundle/execd:latest",
    awsCliJsonImpl: awsCliJsonMock,
    awsCliExecImpl: awsCliExecMock,
    runCommandImpl: runCommandMock,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });

  expect(awsCliJsonMock).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      args: ["ecr", "describe-repositories", "--repository-names", "agent-bundle-code-formatter"],
    }),
  );
  expect(awsCliJsonMock).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      args: ["ecr", "create-repository", "--repository-name", "agent-bundle-code-formatter"],
    }),
  );
});
