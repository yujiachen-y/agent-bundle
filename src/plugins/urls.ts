import type { PluginEntry } from "../schema/bundle.js";

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function toPluginManifestUrl(entry: PluginEntry): string {
  const ref = encodeURIComponent(entry.ref);
  const pluginPath = encodePathSegments(entry.name);
  return `https://raw.githubusercontent.com/${entry.marketplace}/${ref}/${pluginPath}/.claude-plugin/plugin.json`;
}

export function toPluginSkillUrl(entry: PluginEntry, skillName: string): string {
  const ref = encodeURIComponent(entry.ref);
  const pluginPath = encodePathSegments(entry.name);
  const encodedSkill = encodeURIComponent(skillName);
  return `https://raw.githubusercontent.com/${entry.marketplace}/${ref}/${pluginPath}/skills/${encodedSkill}/SKILL.md`;
}

export function toPluginMcpJsonUrl(entry: PluginEntry): string {
  const ref = encodeURIComponent(entry.ref);
  const pluginPath = encodePathSegments(entry.name);
  return `https://raw.githubusercontent.com/${entry.marketplace}/${ref}/${pluginPath}/.mcp.json`;
}

export function toPluginSkillsApiUrl(entry: PluginEntry): string {
  const ref = encodeURIComponent(entry.ref);
  const pluginPath = encodePathSegments(entry.name);
  return `https://api.github.com/repos/${entry.marketplace}/contents/${pluginPath}/skills?ref=${ref}`;
}

export function toPluginCommandUrl(entry: PluginEntry, commandName: string): string {
  const ref = encodeURIComponent(entry.ref);
  const pluginPath = encodePathSegments(entry.name);
  const encodedCommand = encodeURIComponent(commandName);
  return `https://raw.githubusercontent.com/${entry.marketplace}/${ref}/${pluginPath}/commands/${encodedCommand}.md`;
}

export function toPluginCommandsApiUrl(entry: PluginEntry): string {
  const ref = encodeURIComponent(entry.ref);
  const pluginPath = encodePathSegments(entry.name);
  return `https://api.github.com/repos/${entry.marketplace}/contents/${pluginPath}/commands?ref=${ref}`;
}
