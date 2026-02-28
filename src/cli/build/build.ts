import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";

import { generateSystemPromptTemplate } from "../../agent-loop/system-prompt/generate.js";
import { loadAllCommands } from "../../commands/loader.js";
import { loadAllPlugins, type LoadPluginOptions } from "../../plugins/loader.js";
import { mergePluginComponents } from "../../plugins/merge.js";
import type { BundleConfig } from "../../schema/bundle.js";
import { loadAllSkills, type Skill } from "../../skills/loader.js";
import { toSkillSummaries } from "../../skills/summaries.js";
import {
  createResolvedBundleConfig,
  generateSources,
  toCommandSummaries,
  type ResolvedBundleConfig,
  type SandboxImageRef,
} from "./codegen.js";
import { buildE2BTemplate, type BuildE2BTemplateResult } from "./e2b-template.js";
import {
  ensureExecdBaseImage,
  resolveExecdRuntimeDependencies,
  type ExecdRuntime,
  type ExecdRuntimeDependencies,
} from "./execd-base-image.js";
import { buildSandboxImage, type BuildSandboxImageResult } from "./sandbox-image.js";
import { writeGeneratedFiles } from "../generate/generate.js";
import { loadBundleConfig } from "../config/load-bundle-config.js";

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

type BuildDependencies = ExecdRuntimeDependencies & {
  loadConfig?: typeof loadBundleConfig;
  loadSkills?: typeof loadAllSkills;
  loadCommands?: typeof loadAllCommands;
  loadPlugins?: typeof loadAllPlugins;
  generateSystemPrompt?: typeof generateSystemPromptTemplate;
  buildSandbox?: typeof buildSandboxImage;
  buildE2B?: typeof buildE2BTemplate;
  writeFileImpl?: typeof writeFile;
  mkdirImpl?: typeof mkdir;
  pluginOptions?: LoadPluginOptions;
};

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
  execdRuntime: ExecdRuntime;
  stdout: Writable;
  stderr: Writable;
}): Promise<SandboxImageRef> {
  if (input.config.sandbox.provider === "kubernetes") {
    return await buildKubernetesSandboxImage({
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

export async function runBuildCommand(
  options: RunBuildOptions,
  dependencies: BuildDependencies = {},
): Promise<RunBuildResult> {
  const loadConfigImpl = dependencies.loadConfig ?? loadBundleConfig;
  const loadSkillsImpl = dependencies.loadSkills ?? loadAllSkills;
  const loadCommandsImpl = dependencies.loadCommands ?? loadAllCommands;
  const loadPluginsImpl = dependencies.loadPlugins ?? loadAllPlugins;
  const promptGenerator = dependencies.generateSystemPrompt ?? generateSystemPromptTemplate;
  const buildSandboxImpl = dependencies.buildSandbox ?? buildSandboxImage;
  const buildE2BImpl = dependencies.buildE2B ?? buildE2BTemplate;
  const execdRuntime = resolveExecdRuntimeDependencies({
    readFileImpl: dependencies.readFileImpl,
    getPackageVersion: dependencies.getPackageVersion,
    inspectDockerImage: dependencies.inspectDockerImage,
    moduleUrl: dependencies.moduleUrl,
  });
  const writeFileImpl = dependencies.writeFileImpl ?? writeFile;
  const mkdirImpl = dependencies.mkdirImpl ?? mkdir;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const configPath = resolve(options.configPath);
  const bundleDir = dirname(configPath);
  const config = await loadConfigImpl(configPath);

  stdout.write(`Building bundle "${config.name}" from ${configPath}\n`);

  const baseSkills = await loadSkillsImpl(config.skills, bundleDir);
  const baseCommands = config.commands
    ? await loadCommandsImpl(config.commands, bundleDir)
    : [];
  const pluginResults = config.plugins
    ? await loadPluginsImpl(config.plugins, dependencies.pluginOptions)
    : [];
  const existingMcpServers = config.mcp?.servers ?? [];
  const merged = mergePluginComponents(baseSkills, baseCommands, existingMcpServers, pluginResults);
  const skillSummaries = toSkillSummaries(merged.skills);
  const commandSummaries = toCommandSummaries(merged.commands);
  const configWithMergedMcp = merged.mcpServers.length > 0
    ? { ...config, mcp: { servers: merged.mcpServers } }
    : config;
  const sandboxImage = await resolveSandboxImageRef({
    config: configWithMergedMcp,
    bundleDir,
    skills: merged.skills,
    buildSandbox: buildSandboxImpl,
    buildE2B: buildE2BImpl,
    execdRuntime,
    stdout,
    stderr,
  });
  const systemPrompt = promptGenerator({
    basePrompt: config.prompt.system,
    skills: skillSummaries,
  });
  const resolvedConfig = createResolvedBundleConfig({
    config: configWithMergedMcp,
    skills: skillSummaries,
    commands: commandSummaries,
    systemPrompt,
    sandboxImage,
  });
  const commandContents = new Map(merged.commands.map((cmd) => [cmd.name, cmd.content]));
  const sources = generateSources(resolvedConfig, commandContents);
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
