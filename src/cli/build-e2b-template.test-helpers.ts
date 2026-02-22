import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import type { Skill } from "../skills/loader.js";

const CREATED_DIRS: string[] = [];

export type EnvRestore = () => void;

export class MockSpawnedProcess {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();

  private closeListeners: Array<(code: number | null) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];

  public on(event: "close", listener: (code: number | null) => void): this;
  public on(event: "error", listener: (error: Error) => void): this;
  public on(
    event: "close" | "error",
    listener: ((code: number | null) => void) | ((error: Error) => void),
  ): this {
    if (event === "close") {
      this.closeListeners.push(listener as (code: number | null) => void);
      return this;
    }

    this.errorListeners.push(listener as (error: Error) => void);
    return this;
  }

  public emitClose(code: number | null): void {
    this.closeListeners.forEach((listener) => {
      listener(code);
    });
  }

  public emitError(error: Error): void {
    this.errorListeners.forEach((listener) => {
      listener(error);
    });
  }
}

export async function createTempWorkspace(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `agent-bundle-e2b-test-${name}-`));
  CREATED_DIRS.push(directory);
  return directory;
}

export async function createLocalSkill(workspaceDir: string): Promise<Skill> {
  const skillDir = join(workspaceDir, "skills", "format-code");
  await mkdir(skillDir, { recursive: true });

  const skillMarkdown = [
    "---",
    "name: Format Code",
    "description: Format source code in sandbox",
    "---",
    "Use the formatter.",
    "",
  ].join("\n");

  await writeFile(join(skillDir, "SKILL.md"), skillMarkdown, "utf8");
  await writeFile(join(skillDir, "format.py"), "print('format')\n", "utf8");

  return {
    name: "Format Code",
    description: "Format source code in sandbox",
    content: skillMarkdown,
    sourcePath: join(skillDir, "SKILL.md"),
  };
}

export function createRemoteSkill(): Skill {
  return {
    name: "Remote Skill",
    description: "Loaded from remote registry",
    content: [
      "---",
      "name: Remote Skill",
      "description: Loaded from remote registry",
      "---",
      "Use remote logic.",
      "",
    ].join("\n"),
    sourcePath: "https://example.com/skills/remote/SKILL.md",
  };
}

export async function expectPathMissing(path: string): Promise<void> {
  await stat(path);
}

export function withTemporaryEnv(updates: Record<string, string | undefined>): EnvRestore {
  const previousValues = Object.fromEntries(
    Object.keys(updates).map((key) => [key, process.env[key]]),
  );

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });

  return () => {
    Object.entries(previousValues).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    });
  };
}

export async function cleanupTempWorkspaces(): Promise<void> {
  await Promise.all(
    CREATED_DIRS.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
}
