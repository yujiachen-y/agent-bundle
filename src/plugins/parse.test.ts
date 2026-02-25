import { describe, expect, it } from "vitest";

import {
  parseCommandMarkdown,
  parseGitHubDirectoryListing,
  parseGitHubFileListing,
  parseMcpJson,
  parsePluginManifest,
  parseSkillMarkdown,
} from "./parse.js";

describe("parsePluginManifest", () => {
  it("parses a valid manifest", () => {
    const json = JSON.stringify({ name: "finance", version: "1.0.0", description: "Financial tools" });
    const result = parsePluginManifest(json, "https://example.com/plugin.json");

    expect(result).toEqual({ name: "finance", version: "1.0.0", description: "Financial tools" });
  });

  it("returns undefined for missing optional fields", () => {
    const json = JSON.stringify({ name: "finance" });
    const result = parsePluginManifest(json, "https://example.com/plugin.json");

    expect(result).toEqual({ name: "finance", version: undefined, description: undefined });
  });

  it("throws on missing name", () => {
    const json = JSON.stringify({ version: "1.0.0" });

    expect(() => parsePluginManifest(json, "https://example.com/plugin.json"))
      .toThrowError(/must define a non-empty "name" field/);
  });

  it("throws on non-object JSON", () => {
    expect(() => parsePluginManifest("[1,2]", "https://example.com/plugin.json"))
      .toThrowError(/expected a JSON object/);
  });
});

describe("parseSkillMarkdown", () => {
  it("parses markdown with frontmatter and strips category placeholders", () => {
    const markdown = `---
name: Variance Analysis
description: Analyze budget vs actual variances.
---
Use ~~finance tools to analyze variances.
Check ~~reporting for output.`;

    const result = parseSkillMarkdown(markdown, "https://example.com/SKILL.md");

    expect(result.name).toBe("Variance Analysis");
    expect(result.description).toBe("Analyze budget vs actual variances.");
    expect(result.content).not.toContain("~~finance");
    expect(result.content).not.toContain("~~reporting");
    expect(result.content).toContain("Use  tools to analyze variances.");
  });

  it("throws when name is missing", () => {
    const markdown = `---
description: Some desc
---
Body.`;

    expect(() => parseSkillMarkdown(markdown, "test.md"))
      .toThrowError(/must define a non-empty frontmatter field: name/);
  });

  it("throws when description is missing", () => {
    const markdown = `---
name: Test
---
Body.`;

    expect(() => parseSkillMarkdown(markdown, "test.md"))
      .toThrowError(/must define a non-empty frontmatter field: description/);
  });
});

describe("parseGitHubDirectoryListing", () => {
  it("extracts directory names from GitHub API response", () => {
    const json = JSON.stringify([
      { name: "variance-analysis", type: "dir" },
      { name: "README.md", type: "file" },
      { name: "month-end-close", type: "dir" },
    ]);

    const result = parseGitHubDirectoryListing(json, "https://api.github.com/repos/test");
    expect(result).toEqual(["variance-analysis", "month-end-close"]);
  });

  it("throws on non-array response", () => {
    expect(() => parseGitHubDirectoryListing("{}", "https://api.github.com/repos/test"))
      .toThrowError(/Expected directory listing array/);
  });
});

describe("parseCommandMarkdown", () => {
  it("parses markdown with frontmatter including argument-hint", () => {
    const markdown = `---
name: Journal Entry
description: Create a journal entry for the given period.
argument-hint: <period> [account]
---
Create a journal entry for ~~finance $ARGUMENTS.`;

    const result = parseCommandMarkdown(markdown, "https://example.com/commands/journal-entry.md");

    expect(result.name).toBe("Journal Entry");
    expect(result.description).toBe("Create a journal entry for the given period.");
    expect(result.argumentHint).toBe("<period> [account]");
    expect(result.content).not.toContain("~~finance");
    expect(result.content).toContain("Create a journal entry for  $ARGUMENTS.");
    expect(result.sourcePath).toBe("https://example.com/commands/journal-entry.md");
  });

  it("allows empty description", () => {
    const markdown = `---
name: Quick Check
---
Run a quick check.`;

    const result = parseCommandMarkdown(markdown, "test.md");

    expect(result.name).toBe("Quick Check");
    expect(result.description).toBe("");
    expect(result.argumentHint).toBeUndefined();
  });

  it("throws when name is missing", () => {
    const markdown = `---
description: Some desc
---
Body.`;

    expect(() => parseCommandMarkdown(markdown, "test.md"))
      .toThrowError(/Command at test.md must define a non-empty frontmatter field: name/);
  });

  it("handles markdown without frontmatter", () => {
    const markdown = "Just plain content.";

    expect(() => parseCommandMarkdown(markdown, "test.md"))
      .toThrowError(/must define a non-empty frontmatter field: name/);
  });
});

describe("parseGitHubFileListing", () => {
  it("extracts file names without .md extension", () => {
    const json = JSON.stringify([
      { name: "journal-entry.md", type: "file" },
      { name: "reconciliation.md", type: "file" },
      { name: "README.txt", type: "file" },
      { name: "drafts", type: "dir" },
    ]);

    const result = parseGitHubFileListing(json, "https://api.github.com/repos/test");
    expect(result).toEqual(["journal-entry", "reconciliation"]);
  });

  it("returns empty array when no .md files exist", () => {
    const json = JSON.stringify([
      { name: "README.txt", type: "file" },
      { name: "drafts", type: "dir" },
    ]);

    const result = parseGitHubFileListing(json, "https://api.github.com/repos/test");
    expect(result).toEqual([]);
  });

  it("throws on non-array response", () => {
    expect(() => parseGitHubFileListing("{}", "https://api.github.com/repos/test"))
      .toThrowError(/Expected directory listing array/);
  });
});

describe("parseMcpJson", () => {
  it("extracts HTTP servers and skips stdio servers", () => {
    const json = JSON.stringify({
      mcpServers: {
        "finance-api": { type: "http", url: "https://api.example.com/mcp" },
        "local-tool": { type: "stdio", command: "node server.js" },
        "analytics": { type: "http", url: "https://analytics.example.com/mcp" },
      },
    });

    const result = parseMcpJson(json, "https://example.com/.mcp.json");
    expect(result).toEqual([
      { name: "finance-api", url: "https://api.example.com/mcp", auth: "bearer" },
      { name: "analytics", url: "https://analytics.example.com/mcp", auth: "bearer" },
    ]);
  });

  it("returns empty array when mcpServers is missing", () => {
    const result = parseMcpJson("{}", "https://example.com/.mcp.json");
    expect(result).toEqual([]);
  });

  it("throws on non-object JSON", () => {
    expect(() => parseMcpJson("[]", "https://example.com/.mcp.json"))
      .toThrowError(/expected a JSON object/);
  });
});

