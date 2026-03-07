import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { SkillEntry } from "../schema/bundle.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type GitHubResourceListingEntry = {
  name: string;
  type: "file" | "dir";
  downloadUrl?: string;
};

export type ResolveGithubSkillResourcesOptions = {
  cacheDir: string;
  fetchImpl?: FetchLike;
  cache?: boolean;
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toGithubSkillMarkdownPath(entry: Extract<SkillEntry, { github: string }>): string {
  const skillPath = entry.skill?.trim() ?? "";
  if (skillPath.length === 0) {
    return "SKILL.md";
  }

  return skillPath.endsWith(".md") ? skillPath : `${skillPath}/SKILL.md`;
}

function toGithubSkillDirectoryPath(entry: Extract<SkillEntry, { github: string }>): string {
  const skillPath = entry.skill?.trim() ?? "";
  if (skillPath.length === 0) {
    return "";
  }

  if (!skillPath.endsWith(".md")) {
    return skillPath;
  }

  const segments = skillPath.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1).join("/");
}

export function toGithubSkillRawUrl(entry: Extract<SkillEntry, { github: string }>): string {
  const ref = encodeURIComponent(entry.ref);
  const encodedPath = encodePathSegments(toGithubSkillMarkdownPath(entry));
  return `https://raw.githubusercontent.com/${entry.github}/${ref}/${encodedPath}`;
}

function githubApiHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return {
      Accept: "application/vnd.github.v3+json",
    };
  }

  return {
    Accept: "application/vnd.github.v3+json",
    Authorization: `Bearer ${token}`,
  };
}

function toGithubApiContentsUrl(
  entry: Extract<SkillEntry, { github: string }>,
  relativePath = "",
): string {
  const ref = encodeURIComponent(entry.ref);
  const skillDir = toGithubSkillDirectoryPath(entry);
  const fullPath = [skillDir, relativePath]
    .filter((segment) => segment.trim().length > 0)
    .join("/");
  const encodedPath = encodePathSegments(fullPath);
  const suffix = encodedPath.length > 0 ? `/${encodedPath}` : "";
  return `https://api.github.com/repos/${entry.github}/contents${suffix}?ref=${ref}`;
}

function parseGithubResourceListing(
  payload: unknown,
  sourceUrl: string,
): GitHubResourceListingEntry[] {
  if (!Array.isArray(payload)) {
    throw new Error(`Failed to parse GitHub resource listing from ${sourceUrl}: response is not an array.`);
  }

  return payload.flatMap((item): GitHubResourceListingEntry[] => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const rawName = (item as { name?: unknown }).name;
    const rawType = (item as { type?: unknown }).type;
    if (typeof rawName !== "string" || rawName === "SKILL.md") {
      return [];
    }

    if (rawType === "dir") {
      return [{ name: rawName, type: "dir" }];
    }

    if (rawType !== "file") {
      return [];
    }

    const rawDownloadUrl = (item as { download_url?: unknown }).download_url;
    if (typeof rawDownloadUrl !== "string" || rawDownloadUrl.length === 0) {
      return [];
    }

    return [{ name: rawName, type: "file", downloadUrl: rawDownloadUrl }];
  });
}

async function fetchGithubResourceListing(
  entry: Extract<SkillEntry, { github: string }>,
  fetchImpl: FetchLike,
  relativePath = "",
): Promise<GitHubResourceListingEntry[]> {
  const apiUrl = toGithubApiContentsUrl(entry, relativePath);
  const response = await fetchImpl(apiUrl, {
    headers: githubApiHeaders(),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch skill resources from ${apiUrl}: ${response.status} ${response.statusText}`.trim(),
    );
  }

  return parseGithubResourceListing(await response.json(), apiUrl);
}

async function directoryHasFiles(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length > 0;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function downloadGithubResourceFile(
  downloadUrl: string,
  destinationPath: string,
  fetchImpl: FetchLike,
): Promise<void> {
  const response = await fetchImpl(downloadUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download skill resource from ${downloadUrl}: ${response.status} ${response.statusText}`.trim(),
    );
  }

  const fileBytes = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, fileBytes);
}

async function downloadGithubResourcesRecursively(input: {
  entry: Extract<SkillEntry, { github: string }>;
  fetchImpl: FetchLike;
  destinationDir: string;
  relativePath: string;
  listing?: GitHubResourceListingEntry[];
}): Promise<void> {
  const listing = input.listing ?? await fetchGithubResourceListing(
    input.entry,
    input.fetchImpl,
    input.relativePath,
  );

  await Promise.all(
    listing.map(async (resource) => {
      const resourcePath = input.relativePath.length > 0
        ? `${input.relativePath}/${resource.name}`
        : resource.name;

      if (resource.type === "dir") {
        await downloadGithubResourcesRecursively({
          entry: input.entry,
          fetchImpl: input.fetchImpl,
          destinationDir: input.destinationDir,
          relativePath: resourcePath,
        });
        return;
      }

      if (!resource.downloadUrl) {
        return;
      }

      await downloadGithubResourceFile(
        resource.downloadUrl,
        join(input.destinationDir, resourcePath),
        input.fetchImpl,
      );
    }),
  );
}

export async function resolveGithubSkillResources(
  entry: Extract<SkillEntry, { github: string }>,
  options: ResolveGithubSkillResourcesOptions,
): Promise<string | undefined> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const shouldUseCache = options.cache ?? true;
  const apiUrl = toGithubApiContentsUrl(entry);
  const cachePath = join(
    options.cacheDir,
    "resources",
    createHash("sha256").update(apiUrl).digest("hex"),
  );

  if (shouldUseCache && await directoryHasFiles(cachePath)) {
    return cachePath;
  }

  if (!shouldUseCache) {
    await rm(cachePath, { recursive: true, force: true });
  }

  const rootListing = await fetchGithubResourceListing(entry, fetchImpl);
  if (rootListing.length === 0) {
    return undefined;
  }

  await rm(cachePath, { recursive: true, force: true });
  await mkdir(cachePath, { recursive: true });
  await downloadGithubResourcesRecursively({
    entry,
    fetchImpl,
    destinationDir: cachePath,
    relativePath: "",
    listing: rootListing,
  });

  return cachePath;
}
