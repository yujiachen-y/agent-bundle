import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Writable } from "node:stream";

import type { BundleConfig } from "../../schema/bundle.js";
import { DEFAULT_OUTPUT_DIR } from "../build/build.js";
import { loadBundleConfig } from "../config/load-bundle-config.js";
import type { KeyValueArgInput } from "../serve/runtime.js";
import { pushImageToEcr } from "./aws-ecr.js";
import { deployToAwsEcs } from "./aws-ecs.js";
import { ensureAwsPrerequisites } from "./aws-prerequisites.js";
import { teardownAwsResources } from "./aws-teardown.js";

const DEFAULT_AWS_REGION = "us-east-1";
const DEFAULT_AWS_CPU = "256";
const DEFAULT_AWS_MEMORY = "512";
const DEFAULT_AWS_DESIRED_COUNT = 1;
const DEFAULT_AWS_CONTAINER_PORT = 3000;

const SUPPORTED_DEPLOY_TARGET = "aws";

type BundleArtifact = {
  sandboxImage?: {
    ref?: string;
  };
};

type AwsDeployRuntimeConfig = {
  region: string;
  cpu: string;
  memory: string;
  desiredCount: number;
  containerPort: number;
};

export type RunDeployOptions = {
  configPath: string;
  outputDir?: string;
  target?: string | boolean;
  region?: string | boolean;
  secretEntries?: KeyValueArgInput;
  teardown?: boolean;
  stdout?: Writable;
  stderr?: Writable;
};

export type RunDeployResult = {
  target: "aws";
  region: string;
  teardown: boolean;
  imageUri?: string;
  publicIp?: string;
  serviceUrl?: string;
};

export type DeployDependencies = {
  loadConfig?: typeof loadBundleConfig;
  readFileImpl?: typeof readFile;
  ensureAwsPrerequisitesImpl?: typeof ensureAwsPrerequisites;
  pushImageToEcrImpl?: typeof pushImageToEcr;
  deployToAwsEcsImpl?: typeof deployToAwsEcs;
  teardownAwsResourcesImpl?: typeof teardownAwsResources;
  env?: NodeJS.ProcessEnv;
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function resolveTarget(targetArg: string | boolean | undefined, config: BundleConfig): "aws" {
  if (targetArg === true) {
    throw new Error("--target requires a value.");
  }

  const explicitTarget = typeof targetArg === "string" && targetArg.length > 0
    ? targetArg
    : undefined;
  const target = explicitTarget ?? config.deploy?.target;

  if (!target) {
    throw new Error("Missing deploy target. Set deploy.target in config or pass --target aws.");
  }

  if (target !== SUPPORTED_DEPLOY_TARGET) {
    throw new Error(`Unsupported deploy target: ${target}. Supported target: aws.`);
  }

  return "aws";
}

function resolveRegionArg(regionArg: string | boolean | undefined): string | undefined {
  if (regionArg === true) {
    throw new Error("--region requires a value.");
  }

  if (typeof regionArg !== "string" || regionArg.trim().length === 0) {
    return undefined;
  }

  return regionArg;
}

function normalizeSecretEntries(raw: KeyValueArgInput): string[] {
  if (raw === undefined || raw === false) {
    return [];
  }

  if (raw === true) {
    throw new Error("--secret requires a secret key name.");
  }

  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseSecretKeyEntries(raw: KeyValueArgInput): string[] {
  return normalizeSecretEntries(raw).map((entry) => {
    if (entry.includes("=")) {
      throw new Error(
        `Invalid --secret entry "${entry}". Pass only secret key names and provide values via environment variables.`,
      );
    }

    return entry;
  });
}

function resolveSecretsFromEnv(secretKeys: string[], env: NodeJS.ProcessEnv): Record<string, string> {
  const missing: string[] = [];
  const secrets = secretKeys.reduce<Record<string, string>>((acc, key) => {
    const value = env[key];
    if (typeof value === "string") {
      acc[key] = value;
      return acc;
    }

    missing.push(key);
    return acc;
  }, {});

  if (missing.length > 0) {
    throw new Error(
      `Missing secret values in environment: ${missing.join(", ")}. ` +
      "Set environment variables and pass their names with --secret.",
    );
  }

  return secrets;
}

function resolveAwsDeployRuntimeConfig(config: BundleConfig, regionOverride?: string): AwsDeployRuntimeConfig {
  const awsConfig = config.deploy?.aws;

  return {
    region: regionOverride ?? awsConfig?.region ?? DEFAULT_AWS_REGION,
    cpu: awsConfig?.cpu ?? DEFAULT_AWS_CPU,
    memory: awsConfig?.memory ?? DEFAULT_AWS_MEMORY,
    desiredCount: awsConfig?.desiredCount ?? DEFAULT_AWS_DESIRED_COUNT,
    containerPort: awsConfig?.containerPort ?? DEFAULT_AWS_CONTAINER_PORT,
  };
}

function resolveArtifactPath(outputDir: string | undefined, bundleName: string): string {
  const outputRoot = resolve(outputDir ?? DEFAULT_OUTPUT_DIR);
  return join(outputRoot, bundleName, "bundle.json");
}

function extractLocalImageRef(artifact: BundleArtifact): string {
  const imageRef = artifact.sandboxImage?.ref;
  if (!imageRef || imageRef.trim().length === 0) {
    throw new Error("Build artifact bundle.json is missing sandboxImage.ref. Run `agent-bundle build` first.");
  }

  return imageRef;
}

async function loadBuiltBundleArtifact(
  artifactPath: string,
  readFileImpl: typeof readFile,
): Promise<BundleArtifact> {
  try {
    const artifactSource = await readFileImpl(artifactPath, "utf8");
    return JSON.parse(artifactSource) as BundleArtifact;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Build artifact not found at ${artifactPath}. Run \`agent-bundle build\` first.`);
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse build artifact JSON: ${error.message}`);
    }

    throw error;
  }
}

function toServiceUrl(publicIp: string | undefined, containerPort: number): string | undefined {
  if (!publicIp) {
    return undefined;
  }

  return `http://${publicIp}:${containerPort}`;
}

export async function runDeployCommand(
  options: RunDeployOptions,
  dependencies: DeployDependencies = {},
): Promise<RunDeployResult> {
  const loadConfigImpl = dependencies.loadConfig ?? loadBundleConfig;
  const readFileImpl = dependencies.readFileImpl ?? readFile;
  const ensureAwsPrerequisitesImpl = dependencies.ensureAwsPrerequisitesImpl ?? ensureAwsPrerequisites;
  const pushImageToEcrImpl = dependencies.pushImageToEcrImpl ?? pushImageToEcr;
  const deployToAwsEcsImpl = dependencies.deployToAwsEcsImpl ?? deployToAwsEcs;
  const teardownAwsResourcesImpl = dependencies.teardownAwsResourcesImpl ?? teardownAwsResources;
  const env = dependencies.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const configPath = resolve(options.configPath);
  const config = await loadConfigImpl(configPath);
  const target = resolveTarget(options.target, config);
  const awsConfig = resolveAwsDeployRuntimeConfig(config, resolveRegionArg(options.region));

  stdout.write(`Deploying bundle "${config.name}" from ${configPath}\n`);

  if (options.teardown) {
    stdout.write("[deploy] Running AWS teardown\n");
    await ensureAwsPrerequisitesImpl({
      region: awsConfig.region,
      requireDocker: false,
      stdout,
      stderr,
    });
    await teardownAwsResourcesImpl({
      region: awsConfig.region,
      bundleName: config.name,
      stdout,
      stderr,
    });

    stdout.write("[deploy] AWS teardown completed\n");
    return {
      target,
      region: awsConfig.region,
      teardown: true,
    };
  }

  const secretKeys = parseSecretKeyEntries(options.secretEntries);
  const secrets = resolveSecretsFromEnv(secretKeys, env);

  stdout.write("[deploy] Running AWS preflight checks\n");
  await ensureAwsPrerequisitesImpl({
    region: awsConfig.region,
    requireDocker: true,
    stdout,
    stderr,
  });

  const artifactPath = resolveArtifactPath(options.outputDir, config.name);
  stdout.write(`[deploy] Loading build artifact ${artifactPath}\n`);
  const artifact = await loadBuiltBundleArtifact(artifactPath, readFileImpl);
  const localImageRef = extractLocalImageRef(artifact);

  stdout.write("[deploy] Pushing image to ECR\n");
  const ecrResult = await pushImageToEcrImpl({
    region: awsConfig.region,
    bundleName: config.name,
    localImageRef,
    stdout,
    stderr,
  });

  stdout.write("[deploy] Deploying ECS service\n");
  const ecsResult = await deployToAwsEcsImpl({
    region: awsConfig.region,
    bundleName: config.name,
    imageUri: ecrResult.imageUri,
    secrets,
    deployConfig: {
      cpu: awsConfig.cpu,
      memory: awsConfig.memory,
      desiredCount: awsConfig.desiredCount,
      containerPort: awsConfig.containerPort,
    },
    stdout,
    stderr,
  });

  const serviceUrl = toServiceUrl(ecsResult.publicIp, awsConfig.containerPort);
  stdout.write(`[deploy] Deployment completed (service: ${ecsResult.serviceName})\n`);
  if (serviceUrl) {
    stdout.write(`[deploy] Service URL: ${serviceUrl}\n`);
  }

  return {
    target,
    region: awsConfig.region,
    teardown: false,
    imageUri: ecrResult.imageUri,
    publicIp: ecsResult.publicIp,
    serviceUrl,
  };
}
