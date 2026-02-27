import { describe, expect, it } from "vitest";

import { mergePluginComponents } from "./merge.js";
import type { PluginComponents } from "./types.js";

function createSkill(name: string) {
  return {
    name,
    description: `${name} description`,
    content: `---\nname: ${name}\n---\nBody.`,
    sourcePath: `/skills/${name}/SKILL.md`,
  };
}

function createCommand(name: string) {
  return {
    name,
    description: `${name} description`,
    content: `---\nname: ${name}\n---\nRun $ARGUMENTS.`,
    sourcePath: `/commands/${name}.md`,
  };
}

describe("mergePluginComponents", () => {
  it("merges plugin skills after existing skills", () => {
    const existing = [createSkill("local-skill")];
    const plugins: PluginComponents[] = [
      {
        skills: [createSkill("plugin-skill-a"), createSkill("plugin-skill-b")],
        commands: [],
        mcpServers: [],
        metadata: { name: "test-plugin" },
      },
    ];

    const result = mergePluginComponents(existing, [], [], plugins);

    expect(result.skills.map((s) => s.name)).toEqual([
      "local-skill",
      "plugin-skill-a",
      "plugin-skill-b",
    ]);
  });

  it("deduplicates MCP servers by name, keeping existing ones", () => {
    const existingServers = [
      {
        transport: "http" as const,
        name: "shared-api",
        url: "https://original.example.com/mcp",
        auth: "bearer" as const,
      },
    ];
    const plugins: PluginComponents[] = [
      {
        skills: [],
        commands: [],
        mcpServers: [
          {
            transport: "http" as const,
            name: "shared-api",
            url: "https://duplicate.example.com/mcp",
            auth: "bearer" as const,
          },
          {
            transport: "http" as const,
            name: "new-api",
            url: "https://new.example.com/mcp",
            auth: "bearer" as const,
          },
        ],
        metadata: { name: "test-plugin" },
      },
    ];

    const result = mergePluginComponents([], [], existingServers, plugins);

    expect(result.mcpServers).toHaveLength(2);
    expect(result.mcpServers[0].url).toBe("https://original.example.com/mcp");
    expect(result.mcpServers[1].name).toBe("new-api");
  });

  it("returns empty arrays when no plugins provided", () => {
    const result = mergePluginComponents([], [], [], []);

    expect(result.skills).toEqual([]);
    expect(result.commands).toEqual([]);
    expect(result.mcpServers).toEqual([]);
  });

  it("merges multiple plugins in order", () => {
    const plugins: PluginComponents[] = [
      {
        skills: [createSkill("a")],
        commands: [createCommand("cmd-a")],
        mcpServers: [{
          transport: "http" as const,
          name: "api-a",
          url: "https://a.example.com/mcp",
          auth: "bearer" as const,
        }],
        metadata: { name: "plugin-a" },
      },
      {
        skills: [createSkill("b")],
        commands: [createCommand("cmd-b")],
        mcpServers: [{
          transport: "http" as const,
          name: "api-b",
          url: "https://b.example.com/mcp",
          auth: "bearer" as const,
        }],
        metadata: { name: "plugin-b" },
      },
    ];

    const result = mergePluginComponents([], [], [], plugins);

    expect(result.skills.map((s) => s.name)).toEqual(["a", "b"]);
    expect(result.commands.map((c) => c.name)).toEqual(["cmd-a", "cmd-b"]);
    expect(result.mcpServers.map((s) => s.name)).toEqual(["api-a", "api-b"]);
  });

});

describe("mergePluginComponents commands", () => {
  it("merges plugin commands after existing commands", () => {
    const existingCommands = [createCommand("local-cmd")];
    const plugins: PluginComponents[] = [
      {
        skills: [],
        commands: [createCommand("plugin-cmd-a"), createCommand("plugin-cmd-b")],
        mcpServers: [],
        metadata: { name: "test-plugin" },
      },
    ];

    const result = mergePluginComponents([], existingCommands, [], plugins);

    expect(result.commands.map((c) => c.name)).toEqual([
      "local-cmd",
      "plugin-cmd-a",
      "plugin-cmd-b",
    ]);
  });

  it("preserves existing commands when no plugins have commands", () => {
    const existingCommands = [createCommand("local-cmd")];
    const plugins: PluginComponents[] = [
      {
        skills: [createSkill("skill-a")],
        commands: [],
        mcpServers: [],
        metadata: { name: "test-plugin" },
      },
    ];

    const result = mergePluginComponents([], existingCommands, [], plugins);

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].name).toBe("local-cmd");
  });
});
