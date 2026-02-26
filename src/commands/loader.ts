import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

import type { CommandEntry } from "../schema/bundle.js";
import type { Command } from "./types.js";

const DEFAULT_CACHE_DIR = "node_modules/.cache/agent-bundle/commands";
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;
const CATEGORY_PLACEHOLDER_PATTERN = /~~[a-zA-Z0-9_-]+/g;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type LoadCommandOptions = {
  basePath?: string;
  cache?: boolean;
  cacheDir?: string;
  fetchImpl?: FetchLike;
};

export type LoadAllCommandsOptions = Omit<LoadCommandOptions, "basePath">;

type ParsedFrontmatter = {
  frontmatter: Record<string, unknown>;
  content: string;
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripCategoryPlaceholders(content: string): string {
  return content.replace(CATEGORY_PLACEHOLDER_PATTERN, "");
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const normalized = normalizeMarkdown(markdown);
  const match = normalized.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { frontmatter: {}, content: normalized };
  }

  const parsed = parseYaml(match[1]);
  return {
    frontmatter: parsed && typeof parsed === "object" ? parsed : {},
    content: normalized,
  };
}

function getRequiredField(
  frontmatter: Record<string, unknown>,
  fieldName: string,
  sourcePath: string,
): string {
  const value = frontmatter[fieldName];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(`Command at ${sourcePath} must define a non-empty frontmatter field: ${fieldName}`);
}

function getOptionalStringField(frontmatter: Record<string, unknown>, fieldName: string): string | undefined {
  const value = frontmatter[fieldName];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toLocalCommandFilePath(basePath: string, commandPath: string): string {
  const resolved = resolve(basePath, commandPath);
  if (resolved.endsWith(".md")) {
    return resolved;
  }

  return `${resolved}.md`;
}

function toGithubRawUrl(entry: Extract<CommandEntry, { github: string }>): string {
  const normalizedRef = encodeURIComponent(entry.ref);
  const commandPath = entry.command?.trim() ?? "";
  const withExtension = commandPath.length === 0
    ? "COMMAND.md"
    : commandPath.endsWith(".md")
      ? commandPath
      : `${commandPath}.md`;
  const encodedPath = withExtension
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://raw.githubusercontent.com/${entry.github}/${normalizedRef}/${encodedPath}`;
}

function toUrlCommandMarkdownUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (!parsed.pathname.endsWith(".md")) {
    const trimmedPath = parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    parsed.pathname = `${trimmedPath}.md`;
  }

  return parsed.toString();
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

async function fetchRemoteCommandContent(url: string, options: LoadCommandOptions): Promise<string> {
  const shouldUseCache = options.cache ?? true;
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const cachePath = createCachePath(url, cacheDir);

  if (shouldUseCache) {
    const cachedContent = await readCachedContent(cachePath);
    if (cachedContent !== null) {
      return cachedContent;
    }
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch command from ${url}: ${response.status} ${response.statusText}`.trim(),
    );
  }

  const content = await response.text();
  if (shouldUseCache) {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, content, "utf8");
  }

  return content;
}

function getStringFieldOrDefault(frontmatter: Record<string, unknown>, fieldName: string): string {
  const value = frontmatter[fieldName];
  return typeof value === "string" ? value.trim() : "";
}

function toCommand(markdown: string, sourcePath: string): Command {
  const parsed = parseFrontmatter(markdown);
  return {
    name: getRequiredField(parsed.frontmatter, "name", sourcePath),
    description: getStringFieldOrDefault(parsed.frontmatter, "description"),
    argumentHint: getOptionalStringField(parsed.frontmatter, "argument-hint"),
    content: stripCategoryPlaceholders(parsed.content),
    sourcePath,
  };
}

async function loadLocalCommand(
  entry: Extract<CommandEntry, { path: string }>,
  options: LoadCommandOptions,
): Promise<Command> {
  if (!options.basePath) {
    throw new Error("basePath is required to load local commands.");
  }

  const filePath = toLocalCommandFilePath(options.basePath, entry.path);
  const content = await readFile(filePath, "utf8");
  return toCommand(content, filePath);
}

async function loadGithubCommand(
  entry: Extract<CommandEntry, { github: string }>,
  options: LoadCommandOptions,
): Promise<Command> {
  const sourceUrl = toGithubRawUrl(entry);
  const content = await fetchRemoteCommandContent(sourceUrl, options);
  return toCommand(content, sourceUrl);
}

async function loadUrlCommand(
  entry: Extract<CommandEntry, { url: string }>,
  options: LoadCommandOptions,
): Promise<Command> {
  const sourceUrl = toUrlCommandMarkdownUrl(entry.url);
  const content = await fetchRemoteCommandContent(sourceUrl, options);
  return toCommand(content, sourceUrl);
}

export async function loadCommand(entry: CommandEntry, options: LoadCommandOptions = {}): Promise<Command> {
  if ("path" in entry) {
    return await loadLocalCommand(entry, options);
  }

  if ("github" in entry) {
    return await loadGithubCommand(entry, options);
  }

  return await loadUrlCommand(entry, options);
}

export async function loadAllCommands(
  entries: CommandEntry[],
  basePath: string,
  options: LoadAllCommandsOptions = {},
): Promise<Command[]> {
  const results = await Promise.allSettled(
    entries.map((entry) => loadCommand(entry, { ...options, basePath })),
  );

  const commands: Command[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      commands.push(result.value);
    } else {
      console.warn(`[commands] Failed to load command: ${result.reason}`);
    }
  }
  return commands;
}
