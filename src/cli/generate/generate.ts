import { lstat, mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";

import { generateSystemPromptTemplate, type SkillSummary } from "../../agent-loop/system-prompt/generate.js";
import { loadAllCommands } from "../../commands/loader.js";
import { loadAllPlugins, type LoadPluginOptions } from "../../plugins/loader.js";
import { mergePluginComponents } from "../../plugins/merge.js";
import type { BundleConfig } from "../../schema/bundle.js";
import { DEFAULT_DOCKER_SANDBOX_IMAGE } from "../../sandbox/constants.js";
import { loadAllSkills } from "../../skills/loader.js";
import {
  createResolvedBundleConfig,
  generateSources,
  toCommandSummaries,
  type GeneratedSources,
  type ResolvedBundleConfig,
  type SandboxImageRef,
} from "../build/codegen.js";
import { loadBundleConfig } from "../config/load-bundle-config.js";
import { resolveProjectRoot } from "../config/resolve-project-root.js";

export type RunGenerateOptions = {
  configPath: string;
  outputDir?: string;
  stdout?: Writable;
  stderr?: Writable;
};

export type RunGenerateResult = {
  outputDir: string;
  resolvedConfig: ResolvedBundleConfig;
};

export type GenerateDependencies = {
  loadConfig?: typeof loadBundleConfig;
  loadSkills?: typeof loadAllSkills;
  loadCommands?: typeof loadAllCommands;
  loadPlugins?: typeof loadAllPlugins;
  generateSystemPrompt?: typeof generateSystemPromptTemplate;
  writeFileImpl?: typeof writeFile;
  mkdirImpl?: typeof mkdir;
  resolveRoot?: typeof resolveProjectRoot;
  pluginOptions?: LoadPluginOptions;
};

function toSkillSummaries(skills: Awaited<ReturnType<typeof loadAllSkills>>): SkillSummary[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    sourcePath: skill.sourcePath,
    content: skill.content,
  }));
}

function resolveSandboxImageRefFromConfig(config: BundleConfig): SandboxImageRef {
  if (config.sandbox.provider === "kubernetes") {
    const image = config.sandbox.kubernetes?.image;
    if (!image) {
      throw new Error(
        "sandbox.kubernetes.image is required when sandbox provider is kubernetes.",
      );
    }

    return { provider: "kubernetes", ref: image };
  }

  if (config.sandbox.provider === "docker") {
    const image = config.sandbox.docker?.image ?? DEFAULT_DOCKER_SANDBOX_IMAGE;
    return { provider: "docker", ref: image };
  }

  const template = config.sandbox.e2b?.template;
  if (!template) {
    throw new Error(
      "sandbox.e2b.template is required when sandbox provider is e2b.",
    );
  }

  return { provider: "e2b", ref: template };
}

export async function writeGeneratedFiles(input: {
  outputDir: string;
  sources: GeneratedSources;
  mkdirImpl: typeof mkdir;
  writeFileImpl: typeof writeFile;
}): Promise<void> {
  await input.mkdirImpl(input.outputDir, { recursive: true });

  await Promise.all([
    input.writeFileImpl(join(input.outputDir, "index.ts"), input.sources.indexSource, "utf8"),
    input.writeFileImpl(join(input.outputDir, "types.ts"), input.sources.typesSource, "utf8"),
    input.writeFileImpl(join(input.outputDir, "bundle.json"), input.sources.bundleJsonSource, "utf8"),
    input.writeFileImpl(join(input.outputDir, "package.json"), input.sources.packageJsonSource, "utf8"),
  ]);
}

async function ensureSelfLink(projectRoot: string): Promise<void> {
  const nodeModulesDir = join(projectRoot, "node_modules");
  const linkPath = join(nodeModulesDir, "agent-bundle");
  try {
    await lstat(linkPath);
    return;
  } catch {
    await mkdir(nodeModulesDir, { recursive: true });
    await symlink(projectRoot, linkPath, "dir");
  }
}

async function resolveDefaultOutputDir(
  configPath: string,
  bundleName: string,
  resolveRoot: typeof resolveProjectRoot,
): Promise<{ outputDir: string; projectRoot: string }> {
  const projectRoot = await resolveRoot(dirname(resolve(configPath)));
  return {
    outputDir: join(projectRoot, "node_modules", "@agent-bundle", bundleName),
    projectRoot,
  };
}

export async function runGenerateCommand(
  options: RunGenerateOptions,
  dependencies: GenerateDependencies = {},
): Promise<RunGenerateResult> {
  const loadConfigImpl = dependencies.loadConfig ?? loadBundleConfig;
  const loadSkillsImpl = dependencies.loadSkills ?? loadAllSkills;
  const loadCommandsImpl = dependencies.loadCommands ?? loadAllCommands;
  const loadPluginsImpl = dependencies.loadPlugins ?? loadAllPlugins;
  const promptGenerator = dependencies.generateSystemPrompt ?? generateSystemPromptTemplate;
  const writeFileImpl = dependencies.writeFileImpl ?? writeFile;
  const mkdirImpl = dependencies.mkdirImpl ?? mkdir;
  const resolveRoot = dependencies.resolveRoot ?? resolveProjectRoot;
  const stdout = options.stdout ?? process.stdout;

  const configPath = resolve(options.configPath);
  const bundleDir = dirname(configPath);
  const config = await loadConfigImpl(configPath);

  stdout.write(`Generating bundle "${config.name}" from ${configPath}\n`);

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
  const sandboxImage = resolveSandboxImageRefFromConfig(config);
  const systemPrompt = promptGenerator({
    basePrompt: config.prompt.system,
    skills: skillSummaries,
  });
  const configWithMergedMcp = merged.mcpServers.length > 0
    ? { ...config, mcp: { servers: merged.mcpServers } }
    : config;
  const resolvedConfig = createResolvedBundleConfig({
    config: configWithMergedMcp,
    skills: skillSummaries,
    commands: commandSummaries,
    systemPrompt,
    sandboxImage,
  });
  const commandContents = new Map(merged.commands.map((cmd) => [cmd.name, cmd.content]));
  const sources = generateSources(resolvedConfig, commandContents);

  let outputDir: string;
  if (options.outputDir) {
    outputDir = join(resolve(options.outputDir), config.name);
  } else {
    const resolved = await resolveDefaultOutputDir(configPath, config.name, resolveRoot);
    outputDir = resolved.outputDir;
    await ensureSelfLink(resolved.projectRoot);
  }

  await writeGeneratedFiles({
    outputDir,
    sources,
    mkdirImpl,
    writeFileImpl,
  });

  stdout.write(`Generate completed: ${outputDir}\n`);

  return { outputDir, resolvedConfig };
}
