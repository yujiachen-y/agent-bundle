import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";

import { generateSystemPromptTemplate } from "../../agent-loop/system-prompt/generate.js";
import { loadAllCommands } from "../../commands/loader.js";
import { loadAllPlugins, type LoadPluginOptions } from "../../plugins/loader.js";
import { mergePluginComponents } from "../../plugins/merge.js";
import { loadAllSkills } from "../../skills/loader.js";
import { toSkillSummaries } from "../../skills/summaries.js";
import {
  createResolvedBundleConfig,
  generateSources,
  toCommandSummaries,
  type ResolvedBundleConfig,
} from "./codegen.js";
import { buildE2BTemplate } from "./e2b-template.js";
import {
  resolveExecdRuntimeDependencies,
  type ExecdRuntimeDependencies,
} from "./execd-base-image.js";
import { buildSandboxImage } from "./sandbox-image.js";
import { resolveSandboxImageRef } from "./context/build-sandbox-ref.js";
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

  const baseSkills = await loadSkillsImpl(config.skills, bundleDir, {
    resolveResources: true,
  });
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
