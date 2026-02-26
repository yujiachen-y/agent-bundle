import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAllCommands, loadCommand } from "./loader.js";

const CREATED_DIRS: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-bundle-commands-"));
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

const COMMAND_MARKDOWN = `---
name: Quick Analysis
description: Run a quick financial analysis.
argument-hint: <ticker> [period]
---
Analyze the financial data for $ARGUMENTS.
`;

const COMMAND_MARKDOWN_NO_HINT = `---
name: Reconciliation
description: Reconcile accounts for the given period.
---
Reconcile accounts for $ARGUMENTS.
`;

describe("loadAllCommands with local paths", () => {
  it("loads a flat .md command file relative to basePath", async () => {
    const basePath = await createTempDirectory();
    const commandPath = join(basePath, "commands", "quick-analysis.md");
    await mkdir(dirname(commandPath), { recursive: true });
    await writeFile(commandPath, COMMAND_MARKDOWN, "utf8");

    const commands = await loadAllCommands(
      [{ path: "./commands/quick-analysis" }],
      basePath,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      name: "Quick Analysis",
      description: "Run a quick financial analysis.",
      argumentHint: "<ticker> [period]",
      sourcePath: commandPath,
    });
    expect(commands[0].content).toContain("Analyze the financial data");
  });

  it("loads a command with explicit .md extension", async () => {
    const basePath = await createTempDirectory();
    const commandPath = join(basePath, "commands", "reconciliation.md");
    await mkdir(dirname(commandPath), { recursive: true });
    await writeFile(commandPath, COMMAND_MARKDOWN_NO_HINT, "utf8");

    const commands = await loadAllCommands(
      [{ path: "./commands/reconciliation.md" }],
      basePath,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("Reconciliation");
    expect(commands[0].argumentHint).toBeUndefined();
  });
});

describe("loadCommand frontmatter validation", () => {
  it("throws when required name field is missing", async () => {
    const basePath = await createTempDirectory();
    const commandPath = join(basePath, "broken.md");
    await writeFile(
      commandPath,
      `---
description: Some desc
---
Body.
`,
      "utf8",
    );

    await expect(
      loadCommand({ path: "./broken" }, { basePath }),
    ).rejects.toThrowError(/must define a non-empty frontmatter field: name/);
  });

  it("defaults description to empty string when not provided", async () => {
    const basePath = await createTempDirectory();
    const commandPath = join(basePath, "no-desc.md");
    await writeFile(
      commandPath,
      `---
name: NoDesc
---
Body.
`,
      "utf8",
    );

    const command = await loadCommand({ path: "./no-desc" }, { basePath });
    expect(command.name).toBe("NoDesc");
    expect(command.description).toBe("");
  });

  it("strips category placeholders from content", async () => {
    const basePath = await createTempDirectory();
    const commandPath = join(basePath, "cmd.md");
    await writeFile(
      commandPath,
      `---
name: TestCmd
description: Test command.
---
Use ~~finance tools here.
`,
      "utf8",
    );

    const command = await loadCommand({ path: "./cmd" }, { basePath });
    expect(command.content).not.toContain("~~finance");
    expect(command.content).toContain("Use  tools here.");
  });
});

describe("loadCommand remote loading", () => {
  it("fetches from GitHub raw URL", async () => {
    const fetchMock = vi.fn(async () => new Response(COMMAND_MARKDOWN, { status: 200 }));

    const command = await loadCommand(
      { github: "acme/commands-repo", command: "quick-analysis", ref: "main" },
      { cache: false, fetchImpl: fetchMock },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/acme/commands-repo/main/quick-analysis.md",
    );
    expect(command.name).toBe("Quick Analysis");
    expect(command.argumentHint).toBe("<ticker> [period]");
  });

  it("fetches from URL and appends .md", async () => {
    const fetchMock = vi.fn(async () => new Response(COMMAND_MARKDOWN_NO_HINT, { status: 200 }));

    const command = await loadCommand(
      { url: "https://registry.example.com/commands/reconciliation" },
      { cache: false, fetchImpl: fetchMock },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://registry.example.com/commands/reconciliation.md",
    );
    expect(command.name).toBe("Reconciliation");
  });

  it("does not double-append .md for URL that already ends with .md", async () => {
    const fetchMock = vi.fn(async () => new Response(COMMAND_MARKDOWN, { status: 200 }));

    await loadCommand(
      { url: "https://registry.example.com/commands/quick-analysis.md" },
      { cache: false, fetchImpl: fetchMock },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://registry.example.com/commands/quick-analysis.md",
    );
  });

  it("throws on fetch failure", async () => {
    const fetchMock = vi.fn(async () => new Response("Not Found", { status: 404 }));

    await expect(
      loadCommand(
        { url: "https://registry.example.com/commands/missing" },
        { cache: false, fetchImpl: fetchMock },
      ),
    ).rejects.toThrowError(/Failed to fetch command/);
  });
});

describe("loadCommand caching", () => {
  it("caches fetched content and reuses on second call", async () => {
    const workspaceDir = await createTempDirectory();
    const cacheDir = join(workspaceDir, "cache");
    const fetchMock = vi.fn(async () => new Response(COMMAND_MARKDOWN, { status: 200 }));

    await loadCommand(
      { url: "https://registry.example.com/commands/analysis" },
      { cache: true, cacheDir, fetchImpl: fetchMock },
    );
    const secondLoad = await loadCommand(
      { url: "https://registry.example.com/commands/analysis" },
      { cache: true, cacheDir, fetchImpl: fetchMock },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(secondLoad.name).toBe("Quick Analysis");
    await expect(readdir(cacheDir)).resolves.toHaveLength(1);
  });
});

describe("loadCommand basePath requirement", () => {
  it("throws when basePath is not provided for local command", async () => {
    await expect(
      loadCommand({ path: "./commands/test" }),
    ).rejects.toThrowError(/basePath is required/);
  });
});

describe("loadAllCommands partial failure", () => {
  it("returns successful commands when some entries fail to load", async () => {
    const basePath = await createTempDirectory();
    const commandPath = join(basePath, "good.md");
    await mkdir(dirname(commandPath), { recursive: true });
    await writeFile(commandPath, COMMAND_MARKDOWN, "utf8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const commands = await loadAllCommands(
      [
        { path: "./good" },
        { path: "./missing-file" },
      ],
      basePath,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("Quick Analysis");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("[commands] Failed to load command");

    warnSpy.mockRestore();
  });

  it("returns empty array when all entries fail", async () => {
    const basePath = await createTempDirectory();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const commands = await loadAllCommands(
      [
        { path: "./missing-a" },
        { path: "./missing-b" },
      ],
      basePath,
    );

    expect(commands).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });
});
