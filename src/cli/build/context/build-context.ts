import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Skill } from "../../../skills/loader.js";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function sanitizeSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "skill";
}

export async function copyDirectoryRecursive(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await mkdir(destinationPath, { recursive: true });
  const entries = await readdir(sourcePath, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const sourceEntryPath = join(sourcePath, entry.name);
      const destinationEntryPath = join(destinationPath, entry.name);

      if (entry.isDirectory()) {
        await copyDirectoryRecursive(sourceEntryPath, destinationEntryPath);
        return;
      }

      if (entry.isFile()) {
        await copyFile(sourceEntryPath, destinationEntryPath);
      }
    }),
  );
}

export async function copySkillResources(skill: Skill, destinationPath: string): Promise<void> {
  if (!skill.resourceDir) {
    return;
  }

  const sourceDir = skill.resourceDir;
  const sourceEntries = await readdir(sourceDir, { withFileTypes: true });

  await Promise.all(
    sourceEntries.map(async (entry) => {
      if (entry.name === "SKILL.md") {
        return;
      }

      const sourceEntryPath = join(sourceDir, entry.name);
      const destinationEntryPath = join(destinationPath, entry.name);

      if (entry.isDirectory()) {
        await copyDirectoryRecursive(sourceEntryPath, destinationEntryPath);
        return;
      }

      if (entry.isFile()) {
        await copyFile(sourceEntryPath, destinationEntryPath);
      }
    }),
  );
}

export async function writeSkillsBuildContext(contextDir: string, skills: Skill[]): Promise<void> {
  const skillsDir = join(contextDir, "skills");
  await rm(skillsDir, { recursive: true, force: true });
  await mkdir(skillsDir, { recursive: true });

  await Promise.all(
    skills.map(async (skill, index) => {
      const skillDirName = `${String(index + 1).padStart(2, "0")}-${sanitizeSegment(skill.name)}`;
      const skillDir = join(skillsDir, skillDirName);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), skill.content, "utf8");
      await copySkillResources(skill, skillDir);
    }),
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function writeToolsBuildContext(
  contextDir: string,
  bundleDir: string,
): Promise<void> {
  const destinationToolsPath = join(contextDir, "tools");
  const sourceToolsPath = join(bundleDir, "tools");

  await rm(destinationToolsPath, { recursive: true, force: true });
  if (await pathExists(sourceToolsPath)) {
    await copyDirectoryRecursive(sourceToolsPath, destinationToolsPath);
    return;
  }

  await mkdir(destinationToolsPath, { recursive: true });
}
