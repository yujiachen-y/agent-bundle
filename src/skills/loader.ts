import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

import type { SkillEntry } from "../schema/bundle.js";
import { resolveGithubSkillResources, toGithubSkillRawUrl } from "./github-resources.js";

const DEFAULT_CACHE_DIR = "node_modules/.cache/agent-bundle/skills";
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type Skill = {
  name: string;
  description: string;
  content: string;
  sourcePath: string;
  resourceDir?: string;
};

export type LoadSkillOptions = {
  basePath?: string;
  cache?: boolean;
  cacheDir?: string;
  fetchImpl?: FetchLike;
  resolveResources?: boolean;
};

export type LoadAllSkillsOptions = Omit<LoadSkillOptions, "basePath">;

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

function getMetadataField(
  frontmatter: Record<string, unknown>,
  fieldName: "name" | "description",
  sourcePath: string,
): string {
  const value = frontmatter[fieldName];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(`Skill at ${sourcePath} must define a non-empty frontmatter field: ${fieldName}`);
}

function toLocalSkillFilePath(basePath: string, skillPath: string): string {
  const resolved = resolve(basePath, skillPath);
  return resolved.endsWith(".md") ? resolved : join(resolved, "SKILL.md");
}

function toUrlSkillMarkdownUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (!parsed.pathname.endsWith(".md")) {
    const trimmedPath = parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    parsed.pathname = `${trimmedPath}/SKILL.md`;
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

async function fetchRemoteSkillContent(url: string, options: LoadSkillOptions): Promise<string> {
  const shouldUseCache = options.cache ?? true;
  const cachePath = createCachePath(url, options.cacheDir ?? DEFAULT_CACHE_DIR);

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
      `Failed to fetch skill from ${url}: ${response.status} ${response.statusText}`.trim(),
    );
  }

  const content = await response.text();
  if (shouldUseCache) {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, content, "utf8");
  }

  return content;
}

function toSkill(markdown: string, sourcePath: string, resourceDir?: string): Skill {
  const parsed = parseFrontmatter(markdown);
  return {
    name: getMetadataField(parsed.frontmatter, "name", sourcePath),
    description: getMetadataField(parsed.frontmatter, "description", sourcePath),
    content: parsed.content,
    sourcePath,
    resourceDir,
  };
}

async function loadLocalSkill(
  entry: Extract<SkillEntry, { path: string }>,
  options: LoadSkillOptions,
): Promise<Skill> {
  if (!options.basePath) {
    throw new Error("basePath is required to load local skills.");
  }

  const filePath = toLocalSkillFilePath(options.basePath, entry.path);
  const content = await readFile(filePath, "utf8");
  return toSkill(content, filePath, options.resolveResources ? dirname(filePath) : undefined);
}

async function loadGithubSkill(
  entry: Extract<SkillEntry, { github: string }>,
  options: LoadSkillOptions,
): Promise<Skill> {
  const sourceUrl = toGithubSkillRawUrl(entry);
  const content = await fetchRemoteSkillContent(sourceUrl, options);
  const resourceDir = options.resolveResources
    ? await resolveGithubSkillResources(entry, {
      cacheDir: options.cacheDir ?? DEFAULT_CACHE_DIR,
      fetchImpl: options.fetchImpl,
      cache: options.cache,
    })
    : undefined;
  return toSkill(content, sourceUrl, resourceDir);
}

async function loadUrlSkill(
  entry: Extract<SkillEntry, { url: string }>,
  options: LoadSkillOptions,
): Promise<Skill> {
  const sourceUrl = toUrlSkillMarkdownUrl(entry.url);
  const content = await fetchRemoteSkillContent(sourceUrl, options);
  return toSkill(content, sourceUrl);
}

export async function loadSkill(entry: SkillEntry, options: LoadSkillOptions = {}): Promise<Skill> {
  if ("path" in entry) {
    return await loadLocalSkill(entry, options);
  }

  if ("github" in entry) {
    return await loadGithubSkill(entry, options);
  }

  return await loadUrlSkill(entry, options);
}

export async function loadAllSkills(
  entries: SkillEntry[],
  basePath: string,
  options: LoadAllSkillsOptions = {},
): Promise<Skill[]> {
  return await Promise.all(
    entries.map(async (entry) => {
      return await loadSkill(entry, { ...options, basePath });
    }),
  );
}
