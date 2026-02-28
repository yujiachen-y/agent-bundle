import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import type { BundleConfig } from "../../../schema/bundle.js";
import { runDeployCommand } from "../deploy.js";

function createConfig(): BundleConfig {
  return {
    name: "code-formatter",
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    },
    prompt: {
      system: "You are a formatter.",
      variables: [],
    },
    sandbox: {
      provider: "kubernetes",
      timeout: 900,
      resources: {
        cpu: 2,
        memory: "512MB",
      },
      kubernetes: {
        image: "agent-bundle/execd:latest",
      },
    },
    skills: [{ path: "./skills/format-code" }],
    deploy: {
      target: "aws",
      aws: {
        region: "us-east-1",
        cpu: "512",
        memory: "1024",
        desiredCount: 2,
        containerPort: 4000,
      },
    },
  };
}

function createDeployMocks() {
  return {
    loadConfigMock: vi.fn(async () => createConfig()),
    readFileMock: vi.fn(async () => {
      return JSON.stringify({
        sandboxImage: {
          ref: "agent-bundle/execd:latest",
        },
      });
    }),
    ensureAwsPrerequisitesMock: vi.fn(async () => {
      return {
        accountId: "123456789012",
        arn: "arn:aws:iam::123456789012:user/test",
        userId: "AIDATEST",
      };
    }),
    pushImageToEcrMock: vi.fn(async () => {
      return {
        repositoryName: "agent-bundle-code-formatter",
        repositoryUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-bundle-code-formatter",
        imageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-bundle-code-formatter:latest",
      };
    }),
    deployToAwsEcsMock: vi.fn(async () => {
      return {
        clusterName: "agent-bundle-code-formatter",
        serviceName: "agent-bundle-code-formatter",
        taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789012:task-definition/agent-bundle-code-formatter:1",
        securityGroupId: "sg-1234",
        publicIp: "1.2.3.4",
      };
    }),
    teardownAwsResourcesMock: vi.fn(async () => {}),
  };
}

it("runDeployCommand runs aws deploy flow and returns resolved endpoint", async () => {
  const mocks = createDeployMocks();

  const result = await runDeployCommand(
    {
      configPath: "/tmp/workspace/agent-bundle.yaml",
      outputDir: "/tmp/workspace/dist",
      target: "aws",
      secretEntries: ["ANTHROPIC_API_KEY", "LOG_LEVEL"],
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    },
    {
      loadConfig: mocks.loadConfigMock,
      readFileImpl: mocks.readFileMock,
      ensureAwsPrerequisitesImpl: mocks.ensureAwsPrerequisitesMock,
      pushImageToEcrImpl: mocks.pushImageToEcrMock,
      deployToAwsEcsImpl: mocks.deployToAwsEcsMock,
      teardownAwsResourcesImpl: mocks.teardownAwsResourcesMock,
      env: {
        ANTHROPIC_API_KEY: "abc123",
        LOG_LEVEL: "debug",
      },
    },
  );

  expect(mocks.readFileMock).toHaveBeenCalledWith("/tmp/workspace/dist/code-formatter/bundle.json", "utf8");
  expect(mocks.deployToAwsEcsMock).toHaveBeenCalledWith(
    expect.objectContaining({
      secrets: {
        ANTHROPIC_API_KEY: "abc123",
        LOG_LEVEL: "debug",
      },
    }),
  );
  expect(result).toEqual({
    target: "aws",
    region: "us-east-1",
    teardown: false,
    imageUri: "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-bundle-code-formatter:latest",
    publicIp: "1.2.3.4",
    serviceUrl: "http://1.2.3.4:4000",
  });
});

it("runDeployCommand runs teardown flow without docker prerequisite", async () => {
  const mocks = createDeployMocks();

  const result = await runDeployCommand(
    {
      configPath: "/tmp/workspace/agent-bundle.yaml",
      target: "aws",
      teardown: true,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    },
    {
      loadConfig: mocks.loadConfigMock,
      ensureAwsPrerequisitesImpl: mocks.ensureAwsPrerequisitesMock,
      teardownAwsResourcesImpl: mocks.teardownAwsResourcesMock,
      pushImageToEcrImpl: mocks.pushImageToEcrMock,
    },
  );

  expect(mocks.ensureAwsPrerequisitesMock).toHaveBeenCalledWith(
    expect.objectContaining({ region: "us-east-1", requireDocker: false }),
  );
  expect(mocks.pushImageToEcrMock).not.toHaveBeenCalled();
  expect(result).toEqual({
    target: "aws",
    region: "us-east-1",
    teardown: true,
  });
});

it("runDeployCommand rejects boolean --target value", async () => {
  const mocks = createDeployMocks();

  await expect(
    runDeployCommand(
      {
        configPath: "/tmp/workspace/agent-bundle.yaml",
        target: true,
      },
      {
        loadConfig: mocks.loadConfigMock,
      },
    ),
  ).rejects.toThrow("--target requires a value.");
});

it("runDeployCommand rejects boolean --region value", async () => {
  const mocks = createDeployMocks();

  await expect(
    runDeployCommand(
      {
        configPath: "/tmp/workspace/agent-bundle.yaml",
        region: true,
      },
      {
        loadConfig: mocks.loadConfigMock,
      },
    ),
  ).rejects.toThrow("--region requires a value.");
});

it("runDeployCommand rejects missing build artifact", async () => {
  const mocks = createDeployMocks();
  mocks.readFileMock.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));

  await expect(
    runDeployCommand(
      {
        configPath: "/tmp/workspace/agent-bundle.yaml",
        target: "aws",
      },
      {
        loadConfig: mocks.loadConfigMock,
        readFileImpl: mocks.readFileMock,
        ensureAwsPrerequisitesImpl: mocks.ensureAwsPrerequisitesMock,
        env: {},
      },
    ),
  ).rejects.toThrow("Build artifact not found");
});

it("runDeployCommand rejects invalid bundle.json", async () => {
  const mocks = createDeployMocks();
  mocks.readFileMock.mockResolvedValueOnce("not-json");

  await expect(
    runDeployCommand(
      {
        configPath: "/tmp/workspace/agent-bundle.yaml",
        target: "aws",
      },
      {
        loadConfig: mocks.loadConfigMock,
        readFileImpl: mocks.readFileMock,
        ensureAwsPrerequisitesImpl: mocks.ensureAwsPrerequisitesMock,
        env: {},
      },
    ),
  ).rejects.toThrow("Failed to parse build artifact JSON");
});

it("runDeployCommand rejects --secret entries with inline values", async () => {
  const mocks = createDeployMocks();

  await expect(
    runDeployCommand(
      {
        configPath: "/tmp/workspace/agent-bundle.yaml",
        target: "aws",
        secretEntries: "ANTHROPIC_API_KEY=abc123",
      },
      {
        loadConfig: mocks.loadConfigMock,
      },
    ),
  ).rejects.toThrow("Invalid --secret entry");
});

it("runDeployCommand rejects missing secret environment values", async () => {
  const mocks = createDeployMocks();

  await expect(
    runDeployCommand(
      {
        configPath: "/tmp/workspace/agent-bundle.yaml",
        target: "aws",
        secretEntries: ["ANTHROPIC_API_KEY"],
      },
      {
        loadConfig: mocks.loadConfigMock,
        env: {},
      },
    ),
  ).rejects.toThrow("Missing secret values in environment");
});
