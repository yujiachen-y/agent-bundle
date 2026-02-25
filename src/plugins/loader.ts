import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PluginEntry } from "../schema/bundle.js";
import {
  parseCommandMarkdown,
  parseGitHubDirectoryListing,
  parseGitHubFileListing,
  parseMcpJson,
  parsePluginManifest,
  parseSkillMarkdown,
} from "./parse.js";
import type { PluginComponents } from "./types.js";
import {
  toPluginCommandsApiUrl,
  toPluginCommandUrl,
  toPluginManifestUrl,
  toPluginMcpJsonUrl,
  toPluginSkillsApiUrl,
  toPluginSkillUrl,
} from "./urls.js";

const DEFAULT_CACHE_DIR = "node_modules/.cache/agent-bundle/plugins";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type LoadPluginOptions = {
  cache?: boolean;
  cacheDir?: string;
  fetchImpl?: FetchLike;
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function createCachePath(url: string, cacheDir: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  return join(cacheDir, hash);
}

async function readCachedContent(cachePath: string): Promise<string | null> {
  try {
    return await readFile(cachePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function fetchRemoteContent(
  url: string,
  options: LoadPluginOptions,
): Promise<string> {
  const shouldCache = options.cache ?? true;
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const cachePath = createCachePath(url, cacheDir);

  if (shouldCache) {
    const cached = await readCachedContent(cachePath);
    if (cached !== null) {
      return cached;
    }
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`.trim());
  }

  const content = await response.text();
  if (shouldCache) {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, content, "utf8");
  }

  return content;
}

async function fetchOptionalContent(
  url: string,
  options: LoadPluginOptions,
): Promise<string | null> {
  try {
    return await fetchRemoteContent(url, options);
  } catch {
    return null;
  }
}

async function resolveSkillNames(entry: PluginEntry, options: LoadPluginOptions): Promise<string[]> {
  if (entry.skills && entry.skills.length > 0) {
    return entry.skills;
  }

  const apiUrl = toPluginSkillsApiUrl(entry);
  const content = await fetchRemoteContent(apiUrl, { ...options, cache: false });
  return parseGitHubDirectoryListing(content, apiUrl);
}

async function resolveCommandNames(entry: PluginEntry, options: LoadPluginOptions): Promise<string[]> {
  if (entry.commands && entry.commands.length > 0) {
    return entry.commands;
  }

  const apiUrl = toPluginCommandsApiUrl(entry);
  try {
    const content = await fetchRemoteContent(apiUrl, { ...options, cache: false });
    return parseGitHubFileListing(content, apiUrl);
  } catch {
    return [];
  }
}

export async function loadPlugin(
  entry: PluginEntry,
  options: LoadPluginOptions = {},
): Promise<PluginComponents> {
  const manifestUrl = toPluginManifestUrl(entry);
  const manifestJson = await fetchRemoteContent(manifestUrl, options);
  const metadata = parsePluginManifest(manifestJson, manifestUrl);

  const skillNames = await resolveSkillNames(entry, options);
  const skills = await Promise.all(
    skillNames.map(async (skillName) => {
      const skillUrl = toPluginSkillUrl(entry, skillName);
      const markdown = await fetchRemoteContent(skillUrl, options);
      return parseSkillMarkdown(markdown, skillUrl);
    }),
  );

  const commandNames = await resolveCommandNames(entry, options);
  const commands = await Promise.all(
    commandNames.map(async (commandName) => {
      const commandUrl = toPluginCommandUrl(entry, commandName);
      const markdown = await fetchRemoteContent(commandUrl, options);
      return parseCommandMarkdown(markdown, commandUrl);
    }),
  );

  const mcpJsonUrl = toPluginMcpJsonUrl(entry);
  const mcpJson = await fetchOptionalContent(mcpJsonUrl, options);
  const mcpServers = mcpJson !== null ? parseMcpJson(mcpJson, mcpJsonUrl) : [];

  return { skills, commands, mcpServers, metadata };
}

export async function loadAllPlugins(
  entries: PluginEntry[],
  options: LoadPluginOptions = {},
): Promise<PluginComponents[]> {
  return await Promise.all(
    entries.map(async (entry) => loadPlugin(entry, options)),
  );
}
