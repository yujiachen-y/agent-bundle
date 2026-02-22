import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";

import { generateSystemPromptTemplate, type SkillSummary } from "../agent-loop/system-prompt/generate.js";
import type { BundleConfig } from "../schema/bundle.js";
import { loadAllSkills, type Skill } from "../skills/loader.js";
import {
  createResolvedBundleConfig,
  generateSources,
  type ResolvedBundleConfig,
  type SandboxImageRef,
} from "./build-codegen.js";
import { buildE2BTemplate, type BuildE2BTemplateResult } from "./build-e2b-template.js";
import { buildSandboxImage, type BuildSandboxImageResult } from "./build-sandbox-image.js";
import { loadBundleConfig } from "./load-bundle-config.js";

export const DEFAULT_OUTPUT_DIR = "dist";

export type RunBuildOptions = {
  configPath: string;
  outputDir?: string;
  stdout?: Writable;
  stderr?: Writable;
};

export type RunBuildResult = {
  outputDir: string;
  resolvedConfig: ResolvedBundleConfig;
};

type BuildDependencies = {
  loadConfig?: typeof loadBundleConfig;
  loadSkills?: typeof loadAllSkills;
  generateSystemPrompt?: typeof generateSystemPromptTemplate;
  buildSandbox?: typeof buildSandboxImage;
  buildE2B?: typeof buildE2BTemplate;
  writeFileImpl?: typeof writeFile;
  mkdirImpl?: typeof mkdir;
};

function toSkillSummaries(skills: Awaited<ReturnType<typeof loadAllSkills>>): SkillSummary[] {
  return skills.map((skill) => {
    return {
      name: skill.name,
      description: skill.description,
      sourcePath: skill.sourcePath,
    };
  });
}

function ensureKubernetesImage(config: BundleConfig): string {
  const image = config.sandbox.kubernetes?.image;
  if (!image) {
    throw new Error(
      "sandbox.kubernetes.image is required when sandbox provider is kubernetes.",
    );
  }

  return image;
}

function ensureE2BTemplate(config: BundleConfig): string {
  const template = config.sandbox.e2b?.template;
  if (!template) {
    throw new Error("sandbox.e2b.template is required when sandbox provider is e2b.");
  }

  return template;
}

async function buildKubernetesSandboxImage(input: {
  config: BundleConfig;
  bundleDir: string;
  buildSandbox: typeof buildSandboxImage;
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

  input.stdout.write(`Building sandbox image with Docker: ${imageTag}\n`);
  const buildResult = await input.buildSandbox({
    bundleDir: input.bundleDir,
    dockerfile: buildConfig.dockerfile,
    context: buildConfig.context,
    imageTag,
    stdout: input.stdout,
    stderr: input.stderr,
  });

  return toKubernetesSandboxImageRef(buildResult);
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

  input.stdout.write(`Building sandbox template with E2B: ${template}\n`);
  const buildResult = await input.buildE2B({
    bundleDir: input.bundleDir,
    template,
    skills: input.skills,
    stdout: input.stdout,
    stderr: input.stderr,
  });

  return toE2BSandboxImageRef(buildResult);
}

function toKubernetesSandboxImageRef(result: BuildSandboxImageResult): SandboxImageRef {
  if (result.exitCode !== 0) {
    throw new Error(`docker build failed with exit code ${result.exitCode}.`);
  }

  return {
    provider: "kubernetes",
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

async function resolveSandboxImageRef(input: {
  config: BundleConfig;
  bundleDir: string;
  skills: Skill[];
  buildSandbox: typeof buildSandboxImage;
  buildE2B: typeof buildE2BTemplate;
  stdout: Writable;
  stderr: Writable;
}): Promise<SandboxImageRef> {
  if (input.config.sandbox.provider === "kubernetes") {
    return await buildKubernetesSandboxImage({
      config: input.config,
      bundleDir: input.bundleDir,
      buildSandbox: input.buildSandbox,
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

async function writeGeneratedFiles(input: {
  outputDir: string;
  sources: ReturnType<typeof generateSources>;
  mkdirImpl: typeof mkdir;
  writeFileImpl: typeof writeFile;
}): Promise<void> {
  await input.mkdirImpl(input.outputDir, { recursive: true });

  await Promise.all([
    input.writeFileImpl(join(input.outputDir, "index.ts"), input.sources.indexSource, "utf8"),
    input.writeFileImpl(join(input.outputDir, "types.ts"), input.sources.typesSource, "utf8"),
    input.writeFileImpl(join(input.outputDir, "bundle.json"), input.sources.bundleJsonSource, "utf8"),
  ]);
}

export async function runBuildCommand(
  options: RunBuildOptions,
  dependencies: BuildDependencies = {},
): Promise<RunBuildResult> {
  const loadConfigImpl = dependencies.loadConfig ?? loadBundleConfig;
  const loadSkillsImpl = dependencies.loadSkills ?? loadAllSkills;
  const promptGenerator = dependencies.generateSystemPrompt ?? generateSystemPromptTemplate;
  const buildSandboxImpl = dependencies.buildSandbox ?? buildSandboxImage;
  const buildE2BImpl = dependencies.buildE2B ?? buildE2BTemplate;
  const writeFileImpl = dependencies.writeFileImpl ?? writeFile;
  const mkdirImpl = dependencies.mkdirImpl ?? mkdir;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const configPath = resolve(options.configPath);
  const bundleDir = dirname(configPath);
  const config = await loadConfigImpl(configPath);

  stdout.write(`Building bundle "${config.name}" from ${configPath}\n`);

  const skills = await loadSkillsImpl(config.skills, bundleDir);
  const skillSummaries = toSkillSummaries(skills);
  const sandboxImage = await resolveSandboxImageRef({
    config,
    bundleDir,
    skills,
    buildSandbox: buildSandboxImpl,
    buildE2B: buildE2BImpl,
    stdout,
    stderr,
  });
  const systemPrompt = promptGenerator({
    basePrompt: config.prompt.system,
    skills: skillSummaries,
  });
  const resolvedConfig = createResolvedBundleConfig({
    config,
    skills: skillSummaries,
    systemPrompt,
    sandboxImage,
  });
  const sources = generateSources(resolvedConfig);
  const outputRoot = resolve(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const outputDir = join(outputRoot, config.name);

  await writeGeneratedFiles({
    outputDir,
    sources,
    mkdirImpl,
    writeFileImpl,
  });

  stdout.write(`Build completed: ${outputDir}\n`);

  return {
    outputDir,
    resolvedConfig,
  };
}
