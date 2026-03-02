import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";

import type { BundleConfig } from "../../../schema/bundle.js";
import { DEFAULT_DOCKER_SANDBOX_IMAGE } from "../../../sandbox/constants.js";
import type { Skill } from "../../../skills/loader.js";
import type { SandboxImageRef } from "../codegen.js";
import type { BuildE2BTemplateResult } from "../e2b-template.js";
import type { ExecdRuntime } from "../execd-base-image.js";
import { ensureExecdBaseImage } from "../execd-base-image.js";
import type { BuildSandboxImageResult } from "../sandbox-image.js";
import { buildSandboxImage } from "../sandbox-image.js";
import { buildE2BTemplate } from "../e2b-template.js";
import {
  copyDirectoryRecursive,
  writeSkillsBuildContext,
  writeToolsBuildContext,
} from "./build-context.js";

function ensureKubernetesImage(config: BundleConfig): string {
  const image = config.sandbox.kubernetes?.image;
  if (!image) {
    throw new Error(
      "sandbox.kubernetes.image is required when sandbox provider is kubernetes.",
    );
  }

  return image;
}

function resolveDockerImage(config: BundleConfig): string {
  return config.sandbox.docker?.image ?? DEFAULT_DOCKER_SANDBOX_IMAGE;
}

function ensureE2BTemplate(config: BundleConfig): string {
  const template = config.sandbox.e2b?.template;
  if (!template) {
    throw new Error("sandbox.e2b.template is required when sandbox provider is e2b.");
  }

  return template;
}

function ensureE2BDockerfile(config: BundleConfig): string {
  const dockerfile = config.sandbox.e2b?.build?.dockerfile;
  if (!dockerfile) {
    throw new Error(
      "sandbox.e2b.build.dockerfile is required when sandbox provider is e2b.",
    );
  }

  return dockerfile;
}

async function buildKubernetesSandboxImage(input: {
  config: BundleConfig;
  bundleDir: string;
  skills: Skill[];
  buildSandbox: typeof buildSandboxImage;
  execdRuntime: ExecdRuntime;
  stdout: Writable;
  stderr: Writable;
}): Promise<SandboxImageRef> {
  const imageTag = ensureKubernetesImage(input.config);
  const buildConfig = input.config.sandbox.kubernetes?.build;

  if (!buildConfig) {
    input.stdout.write(`Skipping docker build and using configured image: ${imageTag}\n`);
    return {
      provider: "kubernetes",
      ref: imageTag,
    };
  }

  const baseImageTag = await ensureExecdBaseImage({
    buildSandbox: input.buildSandbox,
    stdout: input.stdout,
    stderr: input.stderr,
    runtime: input.execdRuntime,
  });

  const dockerfilePath = resolve(input.bundleDir, buildConfig.dockerfile);
  const userContext = buildConfig.context
    ? resolve(input.bundleDir, buildConfig.context)
    : dirname(dockerfilePath);
  const mergedContextDir = await mkdtemp(join(tmpdir(), "agent-bundle-k8s-"));
  let buildResult: BuildSandboxImageResult;

  try {
    await copyDirectoryRecursive(userContext, mergedContextDir);
    await writeSkillsBuildContext(mergedContextDir, input.skills);
    await writeToolsBuildContext(mergedContextDir, input.bundleDir);
    await copyFile(dockerfilePath, join(mergedContextDir, "Dockerfile"));

    input.stdout.write(`Building sandbox image with Docker: ${imageTag}\n`);
    buildResult = await input.buildSandbox({
      bundleDir: mergedContextDir,
      dockerfile: "Dockerfile",
      buildArgs: { BASE_IMAGE: baseImageTag },
      imageTag,
      stdout: input.stdout,
      stderr: input.stderr,
    });
  } finally {
    await rm(mergedContextDir, { recursive: true, force: true });
  }

  return toBuiltSandboxImageRef("kubernetes", buildResult);
}

async function buildDockerSandboxImage(input: {
  config: BundleConfig;
  bundleDir: string;
  buildSandbox: typeof buildSandboxImage;
  execdRuntime: ExecdRuntime;
  stdout: Writable;
  stderr: Writable;
}): Promise<SandboxImageRef> {
  const imageTag = resolveDockerImage(input.config);
  const buildConfig = input.config.sandbox.docker?.build;

  if (!buildConfig) {
    input.stdout.write(`Skipping docker build and using configured image: ${imageTag}\n`);
    return {
      provider: "docker",
      ref: imageTag,
    };
  }

  const baseImageTag = await ensureExecdBaseImage({
    buildSandbox: input.buildSandbox,
    stdout: input.stdout,
    stderr: input.stderr,
    runtime: input.execdRuntime,
  });

  input.stdout.write(`Building sandbox image with Docker: ${imageTag}\n`);
  const buildResult = await input.buildSandbox({
    bundleDir: input.bundleDir,
    dockerfile: buildConfig.dockerfile,
    context: buildConfig.context,
    buildArgs: { BASE_IMAGE: baseImageTag },
    imageTag,
    stdout: input.stdout,
    stderr: input.stderr,
  });

  return toBuiltSandboxImageRef("docker", buildResult);
}

async function buildE2BSandboxImage(input: {
  config: BundleConfig;
  bundleDir: string;
  skills: Skill[];
  buildE2B: typeof buildE2BTemplate;
  stdout: Writable;
  stderr: Writable;
}): Promise<SandboxImageRef> {
  const template = ensureE2BTemplate(input.config);
  const dockerfile = ensureE2BDockerfile(input.config);

  input.stdout.write(`Building sandbox template with E2B: ${template}\n`);
  const buildResult = await input.buildE2B({
    bundleDir: input.bundleDir,
    template,
    skills: input.skills,
    dockerfile: resolve(input.bundleDir, dockerfile),
    stdout: input.stdout,
    stderr: input.stderr,
  });

  return toE2BSandboxImageRef(buildResult);
}

function toBuiltSandboxImageRef(
  provider: "kubernetes" | "docker",
  result: BuildSandboxImageResult,
): SandboxImageRef {
  if (result.exitCode !== 0) {
    throw new Error(`docker build failed with exit code ${result.exitCode}.`);
  }

  return {
    provider,
    ref: result.imageTag,
  };
}

function toE2BSandboxImageRef(result: BuildE2BTemplateResult): SandboxImageRef {
  if (result.exitCode !== 0) {
    throw new Error(`e2b template build failed with exit code ${result.exitCode}.`);
  }

  return {
    provider: "e2b",
    ref: result.templateRef,
  };
}

export async function resolveSandboxImageRef(input: {
  config: BundleConfig;
  bundleDir: string;
  skills: Skill[];
  buildSandbox: typeof buildSandboxImage;
  buildE2B: typeof buildE2BTemplate;
  execdRuntime: ExecdRuntime;
  stdout: Writable;
  stderr: Writable;
}): Promise<SandboxImageRef> {
  if (input.config.sandbox.provider === "kubernetes") {
    return await buildKubernetesSandboxImage({
      config: input.config,
      bundleDir: input.bundleDir,
      skills: input.skills,
      buildSandbox: input.buildSandbox,
      execdRuntime: input.execdRuntime,
      stdout: input.stdout,
      stderr: input.stderr,
    });
  }

  if (input.config.sandbox.provider === "docker") {
    return await buildDockerSandboxImage({
      config: input.config,
      bundleDir: input.bundleDir,
      buildSandbox: input.buildSandbox,
      execdRuntime: input.execdRuntime,
      stdout: input.stdout,
      stderr: input.stderr,
    });
  }

  return await buildE2BSandboxImage({
    config: input.config,
    bundleDir: input.bundleDir,
    skills: input.skills,
    buildE2B: input.buildE2B,
    stdout: input.stdout,
    stderr: input.stderr,
  });
}
