import { describe, expect, it } from "vitest";

import {
  toPluginCommandsApiUrl,
  toPluginCommandUrl,
  toPluginManifestUrl,
  toPluginMcpJsonUrl,
  toPluginSkillsApiUrl,
  toPluginSkillUrl,
} from "./urls.js";

const BASE_ENTRY = {
  marketplace: "anthropics/knowledge-work-plugins",
  name: "finance",
  ref: "main",
};

describe("toPluginManifestUrl", () => {
  it("builds the correct manifest URL", () => {
    const url = toPluginManifestUrl(BASE_ENTRY);

    expect(url).toBe(
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.claude-plugin/plugin.json",
    );
  });

  it("encodes special characters in ref", () => {
    const url = toPluginManifestUrl({ ...BASE_ENTRY, ref: "v1.0/beta" });

    expect(url).toContain("v1.0%2Fbeta");
  });
});

describe("toPluginSkillUrl", () => {
  it("builds the correct skill URL", () => {
    const url = toPluginSkillUrl(BASE_ENTRY, "variance-analysis");

    expect(url).toBe(
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/skills/variance-analysis/SKILL.md",
    );
  });
});

describe("toPluginMcpJsonUrl", () => {
  it("builds the correct .mcp.json URL", () => {
    const url = toPluginMcpJsonUrl(BASE_ENTRY);

    expect(url).toBe(
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/.mcp.json",
    );
  });
});

describe("toPluginSkillsApiUrl", () => {
  it("builds the correct GitHub API URL", () => {
    const url = toPluginSkillsApiUrl(BASE_ENTRY);

    expect(url).toBe(
      "https://api.github.com/repos/anthropics/knowledge-work-plugins/contents/finance/skills?ref=main",
    );
  });
});

describe("toPluginCommandUrl", () => {
  it("builds the correct command URL", () => {
    const url = toPluginCommandUrl(BASE_ENTRY, "journal-entry");

    expect(url).toBe(
      "https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/finance/commands/journal-entry.md",
    );
  });

  it("encodes special characters in command name", () => {
    const url = toPluginCommandUrl(BASE_ENTRY, "my command");

    expect(url).toContain("commands/my%20command.md");
  });
});

describe("toPluginCommandsApiUrl", () => {
  it("builds the correct GitHub API URL for commands", () => {
    const url = toPluginCommandsApiUrl(BASE_ENTRY);

    expect(url).toBe(
      "https://api.github.com/repos/anthropics/knowledge-work-plugins/contents/finance/commands?ref=main",
    );
  });

  it("encodes special characters in ref", () => {
    const url = toPluginCommandsApiUrl({ ...BASE_ENTRY, ref: "v2.0/rc" });

    expect(url).toContain("ref=v2.0%2Frc");
  });
});
