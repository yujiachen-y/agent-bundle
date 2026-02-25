import type { McpServerConfig } from "../agent/types.js";
import type { Command } from "../commands/types.js";
import type { Skill } from "../skills/loader.js";
import type { PluginComponents } from "./types.js";

function deduplicateMcpServers(
  existing: readonly McpServerConfig[],
  incoming: readonly McpServerConfig[],
): McpServerConfig[] {
  const seen = new Set(existing.map((server) => server.name));
  const unique = incoming.filter((server) => {
    if (seen.has(server.name)) {
      return false;
    }
    seen.add(server.name);
    return true;
  });

  return [...existing, ...unique];
}

export type MergedPluginResult = {
  skills: Skill[];
  commands: Command[];
  mcpServers: McpServerConfig[];
};

export function mergePluginComponents(
  existingSkills: readonly Skill[],
  existingCommands: readonly Command[],
  existingMcpServers: readonly McpServerConfig[],
  pluginResults: readonly PluginComponents[],
): MergedPluginResult {
  const pluginSkills = pluginResults.flatMap((result) => result.skills);
  const pluginCommands = pluginResults.flatMap((result) => result.commands);
  const pluginMcpServers = pluginResults.flatMap((result) => result.mcpServers);

  return {
    skills: [...existingSkills, ...pluginSkills],
    commands: [...existingCommands, ...pluginCommands],
    mcpServers: deduplicateMcpServers(existingMcpServers, pluginMcpServers),
  };
}
