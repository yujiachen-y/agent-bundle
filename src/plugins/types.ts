import type { McpServerConfig } from "../agent/types.js";
import type { Command } from "../commands/types.js";
import type { Skill } from "../skills/loader.js";

export type PluginManifest = {
  name: string;
  version?: string;
  description?: string;
};

export type PluginComponents = {
  skills: Skill[];
  commands: Command[];
  mcpServers: McpServerConfig[];
  metadata: PluginManifest;
};

export type GitHubDirectoryEntry = {
  name: string;
  type: "file" | "dir";
};

export type McpJsonEntry = {
  type?: string;
  url?: string;
  command?: string;
  args?: unknown[];
  env?: Record<string, string>;
};

export type McpJsonPayload = {
  mcpServers?: Record<string, McpJsonEntry>;
};
