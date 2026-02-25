import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAllPlugins, loadPlugin } from "./loader.js";

const CREATED_DIRS: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-bundle-plugins-"));
  CREATED_DIRS.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    CREATED_DIRS.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

const MANIFEST_JSON = JSON.stringify({
  name: "finance",
  version: "1.0.0",
  description: "Financial analysis tools",
});

const SKILL_MARKDOWN = `---
name: Variance Analysis
description: Analyze budget vs actual variances.
---
Use this skill for variance analysis.
`;

const MCP_JSON = JSON.stringify({
  mcpServers: {
    "finance-api": { type: "http", url: "https://api.example.com/mcp" },
    "local-tool": { type: "stdio", command: "node server.js" },
  },
});

function createPluginFetchMock(responses: Record<string, string>) {
  return vi.fn(async (url: string) => {
    const body = responses[url];
    if (body !== undefined) {
      return new Response(body, { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  });
}

describe("loadPlugin with explicit skills", () => {
  it("fetches manifest, skills, and MCP config", async () => {
    const entry = {
      marketplace: "anthropics/knowledge-work-plugins",
      name: "finance",
      ref: "main",
      skills: ["variance-analysis"],
    };

    const fetchMock = createPluginFetchMock({
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.claude-plugin/plugin.json":
        MANIFEST_JSON,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/skills/variance-analysis/SKILL.md":
        SKILL_MARKDOWN,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.mcp.json":
        MCP_JSON,
    });

    const result = await loadPlugin(entry, { cache: false, fetchImpl: fetchMock });

    expect(result.metadata).toEqual({
      name: "finance",
      version: "1.0.0",
      description: "Financial analysis tools",
    });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("Variance Analysis");
    expect(result.mcpServers).toEqual([
      { name: "finance-api", url: "https://api.example.com/mcp", auth: "bearer" },
    ]);
    // manifest + skill + commands-api-404 + mcp = 4 fetches
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns empty mcpServers when .mcp.json is not found", async () => {
    const entry = {
      marketplace: "anthropics/knowledge-work-plugins",
      name: "finance",
      ref: "main",
      skills: ["variance-analysis"],
    };

    const fetchMock = createPluginFetchMock({
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.claude-plugin/plugin.json":
        MANIFEST_JSON,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/skills/variance-analysis/SKILL.md":
        SKILL_MARKDOWN,
    });

    const result = await loadPlugin(entry, { cache: false, fetchImpl: fetchMock });

    expect(result.mcpServers).toEqual([]);
  });
});

describe("loadPlugin with auto-discovered skills", () => {
  it("uses GitHub API to list skill directories", async () => {
    const entry = {
      marketplace: "anthropics/knowledge-work-plugins",
      name: "finance",
      ref: "main",
    };

    const dirListing = JSON.stringify([
      { name: "variance-analysis", type: "dir" },
      { name: "month-end-close", type: "dir" },
    ]);

    const monthEndSkill = `---
name: Month End Close
description: Automate month-end closing procedures.
---
Use this for month-end close.
`;

    const fetchMock = createPluginFetchMock({
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.claude-plugin/plugin.json":
        MANIFEST_JSON,
      "https://api.github.com/repos/anthropics/knowledge-work-plugins/contents/finance/skills?ref=main":
        dirListing,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/skills/variance-analysis/SKILL.md":
        SKILL_MARKDOWN,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/skills/month-end-close/SKILL.md":
        monthEndSkill,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.mcp.json":
        MCP_JSON,
    });

    const result = await loadPlugin(entry, { cache: false, fetchImpl: fetchMock });

    expect(result.skills).toHaveLength(2);
    expect(result.skills.map((s) => s.name)).toEqual(["Variance Analysis", "Month End Close"]);
  });
});

describe("loadPlugin caching", () => {
  it("caches fetched content and reuses on second call", async () => {
    const cacheDir = join(await createTempDirectory(), "cache");
    const entry = {
      marketplace: "anthropics/knowledge-work-plugins",
      name: "finance",
      ref: "main",
      skills: ["variance-analysis"],
    };

    const fetchMock = createPluginFetchMock({
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.claude-plugin/plugin.json":
        MANIFEST_JSON,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/skills/variance-analysis/SKILL.md":
        SKILL_MARKDOWN,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.mcp.json":
        MCP_JSON,
    });

    await loadPlugin(entry, { cache: true, cacheDir, fetchImpl: fetchMock });
    const second = await loadPlugin(entry, { cache: true, cacheDir, fetchImpl: fetchMock });

    // First call: 4 fetches (manifest + skill + commands-api-404 + mcp).
    // Second call: 1 fetch (commands-api always uncached; manifest + skill + mcp cached).
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(second.skills).toHaveLength(1);
    const files = await readdir(cacheDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
});

describe("loadPlugin error handling", () => {
  it("throws when manifest fetch fails", async () => {
    const entry = {
      marketplace: "anthropics/missing-repo",
      name: "finance",
      ref: "main",
      skills: ["variance-analysis"],
    };

    const fetchMock = createPluginFetchMock({});

    await expect(loadPlugin(entry, { cache: false, fetchImpl: fetchMock }))
      .rejects.toThrowError(/Failed to fetch/);
  });
});

const COMMAND_MARKDOWN = `---
name: Journal Entry
description: Create a journal entry.
argument-hint: <period>
---
Create a journal entry for $ARGUMENTS.
`;

describe("loadPlugin with explicit commands", () => {
  it("fetches commands from plugin when commands list is provided", async () => {
    const entry = {
      marketplace: "anthropics/knowledge-work-plugins",
      name: "finance",
      ref: "main",
      skills: ["variance-analysis"],
      commands: ["journal-entry"],
    };

    const fetchMock = createPluginFetchMock({
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.claude-plugin/plugin.json":
        MANIFEST_JSON,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/skills/variance-analysis/SKILL.md":
        SKILL_MARKDOWN,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/commands/journal-entry.md":
        COMMAND_MARKDOWN,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.mcp.json":
        MCP_JSON,
    });

    const result = await loadPlugin(entry, { cache: false, fetchImpl: fetchMock });

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].name).toBe("Journal Entry");
    expect(result.commands[0].argumentHint).toBe("<period>");
  });
});

describe("loadPlugin with auto-discovered commands", () => {
  it("uses GitHub API to list command files", async () => {
    const entry = {
      marketplace: "anthropics/knowledge-work-plugins",
      name: "finance",
      ref: "main",
      skills: ["variance-analysis"],
    };

    const commandsDirListing = JSON.stringify([
      { name: "journal-entry.md", type: "file" },
      { name: "helpers", type: "dir" },
    ]);

    const fetchMock = createPluginFetchMock({
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.claude-plugin/plugin.json":
        MANIFEST_JSON,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/skills/variance-analysis/SKILL.md":
        SKILL_MARKDOWN,
      "https://api.github.com/repos/anthropics/knowledge-work-plugins/contents/finance/commands?ref=main":
        commandsDirListing,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/commands/journal-entry.md":
        COMMAND_MARKDOWN,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.mcp.json":
        MCP_JSON,
    });

    const result = await loadPlugin(entry, { cache: false, fetchImpl: fetchMock });

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].name).toBe("Journal Entry");
  });

  it("returns empty commands when commands directory does not exist", async () => {
    const entry = {
      marketplace: "anthropics/knowledge-work-plugins",
      name: "finance",
      ref: "main",
      skills: ["variance-analysis"],
    };

    const fetchMock = createPluginFetchMock({
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.claude-plugin/plugin.json":
        MANIFEST_JSON,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/skills/variance-analysis/SKILL.md":
        SKILL_MARKDOWN,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.mcp.json":
        MCP_JSON,
    });

    const result = await loadPlugin(entry, { cache: false, fetchImpl: fetchMock });

    expect(result.commands).toEqual([]);
  });
});

describe("loadAllPlugins", () => {
  it("loads multiple plugins in parallel", async () => {
    const entries = [
      {
        marketplace: "anthropics/knowledge-work-plugins",
        name: "finance",
        ref: "main",
        skills: ["variance-analysis"],
      },
    ];

    const fetchMock = createPluginFetchMock({
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.claude-plugin/plugin.json":
        MANIFEST_JSON,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/skills/variance-analysis/SKILL.md":
        SKILL_MARKDOWN,
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.mcp.json":
        MCP_JSON,
    });

    const results = await loadAllPlugins(entries, { cache: false, fetchImpl: fetchMock });

    expect(results).toHaveLength(1);
    expect(results[0].metadata.name).toBe("finance");
    expect(results[0].commands).toEqual([]);
  });
});
