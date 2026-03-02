import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { withTemporaryEnv } from "../test-helpers/env.js";
import { loadSkill } from "./loader.js";

const CREATED_DIRS: string[] = [];
const GITHUB_ENTRY = {
  github: "acme/invoice-skills",
  skill: "extract-line-items",
  ref: "main",
} as const;
const RAW_URL = "https://raw.githubusercontent.com/acme/invoice-skills/main/extract-line-items/SKILL.md";
const API_URL = "https://api.github.com/repos/acme/invoice-skills/contents/extract-line-items?ref=main";
const ASSETS_API_URL = "https://api.github.com/repos/acme/invoice-skills/contents/extract-line-items/assets?ref=main";
const PDF_DOWNLOAD_URL = "https://download.example.com/theme-showcase.pdf";
const PNG_DOWNLOAD_URL = "https://download.example.com/assets/icon.png";
const SKILL_MARKDOWN = `---
name: Extract Line Items
description: Parse invoice rows from OCR output.
---
Use this skill for invoice extraction.
`;

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-bundle-skills-"));
  CREATED_DIRS.push(directory);
  return directory;
}

function parseHeaderValue(headers: HeadersInit | undefined, name: string): string | null {
  return headers ? new Headers(headers).get(name) : null;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    CREATED_DIRS.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("resource resolution basics", () => {
  it("sets resourceDir for local skills when resolveResources=true", async () => {
    const basePath = await createTempDirectory();
    const skillDir = join(basePath, "skills", "local-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), SKILL_MARKDOWN, "utf8");

    const skill = await loadSkill(
      { path: "./skills/local-skill" },
      {
        basePath,
        resolveResources: true,
      },
    );

    expect(skill.resourceDir).toBe(skillDir);
  });

  it("downloads GitHub resources when resolveResources=true", async () => {
    const workspaceDir = await createTempDirectory();
    const cacheDir = join(workspaceDir, "cache");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === RAW_URL) {
        return new Response(SKILL_MARKDOWN, { status: 200 });
      }
      if (url === API_URL) {
        return new Response(
          JSON.stringify([
            { name: "SKILL.md", type: "file", download_url: RAW_URL },
            { name: "theme-showcase.pdf", type: "file", download_url: PDF_DOWNLOAD_URL },
            { name: "assets", type: "dir" },
          ]),
          { status: 200 },
        );
      }
      if (url === ASSETS_API_URL) {
        return new Response(
          JSON.stringify([{ name: "icon.png", type: "file", download_url: PNG_DOWNLOAD_URL }]),
          { status: 200 },
        );
      }
      if (url === PDF_DOWNLOAD_URL) {
        return new Response(Uint8Array.from([0, 1, 2, 3]), { status: 200 });
      }
      if (url === PNG_DOWNLOAD_URL) {
        return new Response(Uint8Array.from([4, 5, 6, 7]), { status: 200 });
      }

      return new Response("missing", { status: 404, statusText: "Not Found" });
    });

    const skill = await loadSkill(GITHUB_ENTRY, {
      cacheDir,
      fetchImpl: fetchMock,
      resolveResources: true,
    });

    expect(skill.resourceDir).toBeDefined();
    if (!skill.resourceDir) {
      throw new Error("Expected resourceDir for GitHub skill.");
    }

    await expect(readFile(join(skill.resourceDir, "theme-showcase.pdf"))).resolves.toEqual(
      Buffer.from([0, 1, 2, 3]),
    );
    await expect(readFile(join(skill.resourceDir, "assets", "icon.png"))).resolves.toEqual(
      Buffer.from([4, 5, 6, 7]),
    );
  });

  it("leaves GitHub resourceDir undefined when resolveResources is disabled", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === RAW_URL) {
        return new Response(SKILL_MARKDOWN, { status: 200 });
      }

      return new Response("missing", { status: 404, statusText: "Not Found" });
    });

    const skill = await loadSkill(GITHUB_ENTRY, {
      cache: false,
      fetchImpl: fetchMock,
    });

    expect(skill.resourceDir).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(RAW_URL);
  });
});

describe("resource resolution edge cases", () => {
  it("returns undefined resourceDir when GitHub listing has no resources", async () => {
    const workspaceDir = await createTempDirectory();
    const cacheDir = join(workspaceDir, "cache");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === RAW_URL) {
        return new Response(SKILL_MARKDOWN, { status: 200 });
      }
      if (url === API_URL) {
        return new Response(
          JSON.stringify([{ name: "SKILL.md", type: "file", download_url: RAW_URL }]),
          { status: 200 },
        );
      }

      return new Response("missing", { status: 404, statusText: "Not Found" });
    });

    const skill = await loadSkill(GITHUB_ENTRY, {
      cacheDir,
      fetchImpl: fetchMock,
      resolveResources: true,
    });

    expect(skill.resourceDir).toBeUndefined();
  });

  it("preserves binary resource bytes", async () => {
    const workspaceDir = await createTempDirectory();
    const cacheDir = join(workspaceDir, "cache");
    const binaryBytes = Buffer.from([0, 255, 16, 32, 64, 128]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === RAW_URL) {
        return new Response(SKILL_MARKDOWN, { status: 200 });
      }
      if (url === API_URL) {
        return new Response(
          JSON.stringify([{ name: "theme-showcase.pdf", type: "file", download_url: PDF_DOWNLOAD_URL }]),
          { status: 200 },
        );
      }
      if (url === PDF_DOWNLOAD_URL) {
        return new Response(binaryBytes, { status: 200 });
      }

      return new Response("missing", { status: 404, statusText: "Not Found" });
    });

    const skill = await loadSkill(GITHUB_ENTRY, {
      cacheDir,
      fetchImpl: fetchMock,
      resolveResources: true,
    });

    if (!skill.resourceDir) {
      throw new Error("Expected resourceDir for GitHub skill.");
    }

    const cachedBytes = await readFile(join(skill.resourceDir, "theme-showcase.pdf"));
    expect(Buffer.compare(cachedBytes, binaryBytes)).toBe(0);
  });
});

describe("github resource auth", () => {
  it("includes Authorization header only for GitHub API requests", async () => {
    const workspaceDir = await createTempDirectory();
    const cacheDir = join(workspaceDir, "cache");
    const headersByUrl = new Map<string, HeadersInit | undefined>();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      headersByUrl.set(url, init?.headers);

      if (url === RAW_URL) {
        return new Response(SKILL_MARKDOWN, { status: 200 });
      }
      if (url === API_URL) {
        return new Response(
          JSON.stringify([{ name: "theme-showcase.pdf", type: "file", download_url: PDF_DOWNLOAD_URL }]),
          { status: 200 },
        );
      }
      if (url === PDF_DOWNLOAD_URL) {
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200 });
      }

      return new Response("missing", { status: 404, statusText: "Not Found" });
    });
    const restoreEnv = withTemporaryEnv({ GITHUB_TOKEN: "token-value" });

    try {
      await loadSkill(GITHUB_ENTRY, {
        cacheDir,
        fetchImpl: fetchMock,
        resolveResources: true,
      });
    } finally {
      restoreEnv();
    }

    expect(parseHeaderValue(headersByUrl.get(API_URL), "Authorization")).toBe("Bearer token-value");
    expect(parseHeaderValue(headersByUrl.get(PDF_DOWNLOAD_URL), "Authorization")).toBeNull();
  });
});

describe("github resource cache", () => {
  it("reuses cached GitHub resources on repeated calls", async () => {
    const workspaceDir = await createTempDirectory();
    const cacheDir = join(workspaceDir, "cache");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === RAW_URL) {
        return new Response(SKILL_MARKDOWN, { status: 200 });
      }
      if (url === API_URL) {
        return new Response(
          JSON.stringify([{ name: "theme-showcase.pdf", type: "file", download_url: PDF_DOWNLOAD_URL }]),
          { status: 200 },
        );
      }
      if (url === PDF_DOWNLOAD_URL) {
        return new Response(Uint8Array.from([9, 8, 7]), { status: 200 });
      }

      return new Response("missing", { status: 404, statusText: "Not Found" });
    });

    await loadSkill(GITHUB_ENTRY, {
      cacheDir,
      fetchImpl: fetchMock,
      resolveResources: true,
    });
    const second = await loadSkill(GITHUB_ENTRY, {
      cacheDir,
      fetchImpl: fetchMock,
      resolveResources: true,
    });

    const apiCalls = fetchMock.mock.calls.filter((call) => call[0] === API_URL);
    const markdownCalls = fetchMock.mock.calls.filter((call) => call[0] === RAW_URL);
    const downloadCalls = fetchMock.mock.calls.filter((call) => call[0] === PDF_DOWNLOAD_URL);

    expect(second.resourceDir).toBeDefined();
    expect(apiCalls).toHaveLength(1);
    expect(markdownCalls).toHaveLength(1);
    expect(downloadCalls).toHaveLength(1);
  });

  it("does not reuse resource cache when cache=false", async () => {
    const workspaceDir = await createTempDirectory();
    const cacheDir = join(workspaceDir, "cache");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === RAW_URL) {
        return new Response(SKILL_MARKDOWN, { status: 200 });
      }
      if (url === API_URL) {
        return new Response(
          JSON.stringify([{ name: "theme-showcase.pdf", type: "file", download_url: PDF_DOWNLOAD_URL }]),
          { status: 200 },
        );
      }
      if (url === PDF_DOWNLOAD_URL) {
        return new Response(Uint8Array.from([2, 4, 6]), { status: 200 });
      }

      return new Response("missing", { status: 404, statusText: "Not Found" });
    });

    await loadSkill(GITHUB_ENTRY, {
      cache: false,
      cacheDir,
      fetchImpl: fetchMock,
      resolveResources: true,
    });
    await loadSkill(GITHUB_ENTRY, {
      cache: false,
      cacheDir,
      fetchImpl: fetchMock,
      resolveResources: true,
    });

    const apiCalls = fetchMock.mock.calls.filter((call) => call[0] === API_URL);
    const markdownCalls = fetchMock.mock.calls.filter((call) => call[0] === RAW_URL);
    const downloadCalls = fetchMock.mock.calls.filter((call) => call[0] === PDF_DOWNLOAD_URL);
    expect(apiCalls).toHaveLength(2);
    expect(markdownCalls).toHaveLength(2);
    expect(downloadCalls).toHaveLength(2);
  });
});
