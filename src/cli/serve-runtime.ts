import { dirname, resolve } from "node:path";

import { generateSystemPromptTemplate } from "../agent-loop/system-prompt/generate.js";
import type { McpServerConfig } from "../agent/types.js";
import type { BundleConfig } from "../schema/bundle.js";
import { loadAllSkills } from "../skills/loader.js";
import { toSkillSummaries } from "../skills/summaries.js";
import { loadBundleConfig } from "./load-bundle-config.js";

const VARIABLE_ENV_PREFIX = "AGENT_BUNDLE_VAR_";
const MCP_TOKEN_ENV_PREFIX = "AGENT_BUNDLE_MCP_TOKEN_";
const MCP_TOKEN_ENV_FALLBACK_PREFIX = "MCP_TOKEN_";

export type KeyValueArgInput = string | string[] | boolean | undefined;

export type ResolvedServeInputs = {
  configPath: string;
  config: BundleConfig;
  systemPrompt: string;
};

function toEnvSuffix(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
}

function normalizeArgEntries(raw: KeyValueArgInput, optionName: string): string[] {
  if (raw === undefined || raw === false) {
    return [];
  }

  if (raw === true) {
    throw new Error(`${optionName} requires a value in key=value format.`);
  }

  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function parseKeyValueEntries(raw: KeyValueArgInput, optionName: string): Record<string, string> {
  const entries = normalizeArgEntries(raw, optionName);
  return entries.reduce<Record<string, string>>((acc, entry) => {
    const separatorIndex = entry.indexOf("=");
    const key = separatorIndex >= 0 ? entry.slice(0, separatorIndex).trim() : "";
    const value = separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : "";

    if (separatorIndex <= 0 || key.length === 0) {
      throw new Error(
        `Invalid ${optionName} entry "${entry}". Expected key=value with a non-empty key.`,
      );
    }

    acc[key] = value;
    return acc;
  }, {});
}

function readRequiredVariable(
  name: string,
  cliOverrides: Record<string, string>,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const override = cliOverrides[name];
  if (override !== undefined) {
    return override;
  }

  const direct = env[name];
  if (typeof direct === "string") {
    return direct;
  }

  const prefixed = env[`${VARIABLE_ENV_PREFIX}${toEnvSuffix(name)}`];
  if (typeof prefixed === "string") {
    return prefixed;
  }

  return undefined;
}

export function resolveInitVariables(
  variableNames: readonly string[],
  cliOverrides: Record<string, string>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const knownVariables = new Set(variableNames);
  const unknownCliVariables = Object.keys(cliOverrides).filter((name) => !knownVariables.has(name));
  if (unknownCliVariables.length > 0) {
    const expected = variableNames.length > 0 ? variableNames.join(", ") : "<none>";
    throw new Error(
      `Unknown --var entries: ${unknownCliVariables.join(", ")}. Expected variables: ${expected}.`,
    );
  }

  const missing: string[] = [];
  const variables = variableNames.reduce<Record<string, string>>((acc, name) => {
    const value = readRequiredVariable(name, cliOverrides, env);
    if (value === undefined) {
      missing.push(name);
      return acc;
    }

    acc[name] = value;
    return acc;
  }, {});

  if (missing.length > 0) {
    throw new Error(
      `Missing required init variables: ${missing.join(", ")}. ` +
      "Provide them with --var <name>=<value> or env vars <name> / AGENT_BUNDLE_VAR_<NAME>.",
    );
  }

  return variables;
}

export function resolveMcpTokens(
  servers: readonly McpServerConfig[],
  cliOverrides: Record<string, string>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const knownServers = new Set(servers.map((server) => server.name));
  const unknownServers = Object.keys(cliOverrides).filter((name) => !knownServers.has(name));
  if (unknownServers.length > 0) {
    const expected = servers.length > 0 ? servers.map((server) => server.name).join(", ") : "<none>";
    throw new Error(
      `Unknown --mcp-token entries: ${unknownServers.join(", ")}. Expected MCP servers: ${expected}.`,
    );
  }

  return servers.reduce<Record<string, string>>((tokens, server) => {
    if (cliOverrides[server.name] !== undefined) {
      tokens[server.name] = cliOverrides[server.name];
      return tokens;
    }

    const suffix = toEnvSuffix(server.name);
    const prefixed = env[`${MCP_TOKEN_ENV_PREFIX}${suffix}`];
    const fallback = env[`${MCP_TOKEN_ENV_FALLBACK_PREFIX}${suffix}`];
    const value = prefixed ?? fallback;
    if (typeof value === "string") {
      tokens[server.name] = value;
    }

    return tokens;
  }, {});
}

export function resolveServeSandboxConfig(sandbox: BundleConfig["sandbox"]): BundleConfig["sandbox"] {
  if (!sandbox.serve?.provider) {
    return sandbox;
  }

  return {
    ...sandbox,
    provider: sandbox.serve.provider,
  };
}

export async function resolveServeInputs(
  configPath: string,
  loadConfigImpl: typeof loadBundleConfig = loadBundleConfig,
  loadSkillsImpl: typeof loadAllSkills = loadAllSkills,
  generateSystemPromptImpl: typeof generateSystemPromptTemplate = generateSystemPromptTemplate,
): Promise<ResolvedServeInputs> {
  const absoluteConfigPath = resolve(configPath);
  const config = await loadConfigImpl(absoluteConfigPath);
  const bundleDir = dirname(absoluteConfigPath);
  const skills = await loadSkillsImpl(config.skills, bundleDir);

  const systemPrompt = generateSystemPromptImpl({
    basePrompt: config.prompt.system,
    skills: toSkillSummaries(skills),
  });

  return {
    configPath: absoluteConfigPath,
    config,
    systemPrompt,
  };
}
