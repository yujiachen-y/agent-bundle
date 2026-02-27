import { parse as parseYaml } from "yaml";

import type { McpServerConfig } from "../agent/types.js";
import type { Command } from "../commands/types.js";
import type { Skill } from "../skills/loader.js";
import type { GitHubDirectoryEntry, McpJsonPayload, PluginManifest } from "./types.js";

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;
const CATEGORY_PLACEHOLDER_PATTERN = /~~[a-zA-Z0-9_-]+/g;

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripCategoryPlaceholders(content: string): string {
  return content.replace(CATEGORY_PLACEHOLDER_PATTERN, "");
}

function getStringField(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
}

export function parsePluginManifest(json: string, sourceUrl: string): PluginManifest {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid plugin manifest at ${sourceUrl}: expected a JSON object.`);
  }

  const record = parsed as Record<string, unknown>;
  const name = getStringField(record, "name");
  if (name.length === 0) {
    throw new Error(`Plugin manifest at ${sourceUrl} must define a non-empty "name" field.`);
  }

  return {
    name,
    version: getStringField(record, "version") || undefined,
    description: getStringField(record, "description") || undefined,
  };
}

export function parseSkillMarkdown(markdown: string, sourcePath: string): Skill {
  const normalized = normalizeMarkdown(markdown);
  const match = normalized.match(FRONTMATTER_PATTERN);
  const frontmatter: Record<string, unknown> = match
    ? (parseYaml(match[1]) as Record<string, unknown>) ?? {}
    : {};

  const name = getStringField(frontmatter, "name");
  const description = getStringField(frontmatter, "description");

  if (name.length === 0) {
    throw new Error(`Skill at ${sourcePath} must define a non-empty frontmatter field: name`);
  }
  if (description.length === 0) {
    throw new Error(`Skill at ${sourcePath} must define a non-empty frontmatter field: description`);
  }

  return {
    name,
    description,
    content: stripCategoryPlaceholders(normalized),
    sourcePath,
  };
}

export function parseCommandMarkdown(markdown: string, sourcePath: string): Command {
  const normalized = normalizeMarkdown(markdown);
  const match = normalized.match(FRONTMATTER_PATTERN);
  const frontmatter: Record<string, unknown> = match
    ? (parseYaml(match[1]) as Record<string, unknown>) ?? {}
    : {};

  const name = getStringField(frontmatter, "name");
  if (name.length === 0) {
    throw new Error(`Command at ${sourcePath} must define a non-empty frontmatter field: name`);
  }

  const description = getStringField(frontmatter, "description");
  const argumentHint = getStringField(frontmatter, "argument-hint") || undefined;

  return {
    name,
    description,
    argumentHint,
    content: stripCategoryPlaceholders(normalized),
    sourcePath,
  };
}

export function parseGitHubFileListing(json: string, sourceUrl: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected directory listing array from ${sourceUrl}.`);
  }

  return (parsed as GitHubDirectoryEntry[])
    .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""));
}

export function parseGitHubDirectoryListing(json: string, sourceUrl: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected directory listing array from ${sourceUrl}.`);
  }

  return (parsed as GitHubDirectoryEntry[])
    .filter((entry) => entry.type === "dir")
    .map((entry) => entry.name);
}

export function parseMcpJson(json: string, sourceUrl: string): McpServerConfig[] {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid .mcp.json at ${sourceUrl}: expected a JSON object.`);
  }

  const payload = parsed as McpJsonPayload;
  const servers = payload.mcpServers;
  if (!servers || typeof servers !== "object") {
    return [];
  }

  return Object.entries(servers).reduce<McpServerConfig[]>((acc, [name, config]) => {
    if (config.type === "http" && typeof config.url === "string") {
      acc.push({
        transport: "http",
        name,
        url: config.url,
        auth: "bearer",
      });
      return acc;
    }

    if (config.type === "stdio" && typeof config.command === "string") {
      acc.push({
        transport: "stdio",
        name,
        command: config.command,
        ...(isStringArray(config.args) ? { args: config.args } : {}),
        ...(isStringRecord(config.env) ? { env: config.env } : {}),
      });
      return acc;
    }

    if (config.type === "sse" && typeof config.url === "string") {
      acc.push({
        transport: "sse",
        name,
        url: config.url,
        auth: "bearer",
      });
    }

    return acc;
  }, []);
}
