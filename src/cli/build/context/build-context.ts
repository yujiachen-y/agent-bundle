import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type { Skill } from "../../../skills/loader.js";

type DockerInstruction = {
  keyword: string;
  stageIndex: number;
  body: string;
};

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

      if (entry.isSymbolicLink()) {
        await symlink(await readlink(sourceEntryPath), destinationEntryPath);
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

      if (entry.isSymbolicLink()) {
        await symlink(await readlink(sourceEntryPath), destinationEntryPath);
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

function parseDockerInstructions(content: string): DockerInstruction[] {
  const instructions: DockerInstruction[] = [];
  const pendingLines: string[] = [];
  let currentStage = -1;

  function flushPendingLines(): void {
    if (pendingLines.length === 0) {
      return;
    }

    const body = pendingLines.join("\n");
    const keywordMatch = body.trimStart().match(/^([a-zA-Z]+)/);
    pendingLines.length = 0;
    if (!keywordMatch) {
      return;
    }

    const keyword = keywordMatch[1].toUpperCase();
    const stageIndex = keyword === "FROM" ? currentStage + 1 : currentStage;
    instructions.push({ keyword, stageIndex, body });
    if (keyword === "FROM") {
      currentStage = stageIndex;
    }
  }

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (pendingLines.length === 0 && (trimmed === "" || trimmed.startsWith("#"))) {
      continue;
    }

    pendingLines.push(line);
    if (!trimmed.endsWith("\\")) {
      flushPendingLines();
    }
  }

  flushPendingLines();
  return instructions;
}

function stripOuterQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/gu, "");
}

function normalizeCopyPath(value: string): string {
  let normalized = stripOuterQuotes(value).trim();
  if (normalized.endsWith("/.")) {
    normalized = normalized.slice(0, -2);
  }

  normalized = normalized.replace(/\/+$/u, "");
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  return normalized.length > 0 ? normalized : "/";
}

function isSkillsPath(value: string): boolean {
  const normalized = normalizeCopyPath(value);
  if (normalized === "skills") {
    return true;
  }

  return normalized.split("/").at(-1) === "skills";
}

function tokenizeCopyArguments(value: string): string[] {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/gu);
  return matches ?? [];
}

function parseCopyInstruction(instruction: DockerInstruction): {
  flags: string[];
  sources: string[];
  destination: string;
} | null {
  if (instruction.keyword !== "COPY") {
    return null;
  }

  const rawArgs = instruction.body
    .trimStart()
    .slice(instruction.keyword.length)
    .replace(/\\\s*\n\s*/gu, " ")
    .trim();
  const jsonArgsMatch = rawArgs.match(/^(?<flags>(?:--\S+\s+)*)?(?<json>\[.*\])$/su);
  if (jsonArgsMatch?.groups?.json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonArgsMatch.groups.json) as unknown;
    } catch {
      return null;
    }

    if (!Array.isArray(parsed) || parsed.length < 2 || !parsed.every((entry) => typeof entry === "string")) {
      return null;
    }

    return {
      flags: jsonArgsMatch.groups.flags?.trim().split(/\s+/u).filter(Boolean) ?? [],
      sources: parsed.slice(0, -1),
      destination: parsed.at(-1) ?? "",
    };
  }

  const tokens = tokenizeCopyArguments(rawArgs);
  if (tokens.length < 2) {
    return null;
  }

  let flagEnd = 0;
  while (flagEnd < tokens.length && tokens[flagEnd].startsWith("--")) {
    flagEnd += 1;
  }

  if (tokens.length - flagEnd < 2) {
    return null;
  }

  return {
    flags: tokens.slice(0, flagEnd),
    sources: tokens.slice(flagEnd, -1),
    destination: tokens.at(-1) ?? "",
  };
}

function hasSkillsCopyInstructionInFinalStage(content: string): boolean {
  const instructions = parseDockerInstructions(content);
  const finalStage = instructions.at(-1)?.stageIndex ?? -1;
  return instructions.some((instruction) => {
    if (instruction.stageIndex !== finalStage) {
      return false;
    }

    const parsed = parseCopyInstruction(instruction);
    if (!parsed) {
      return false;
    }

    const destination = normalizeCopyPath(parsed.destination);
    if (destination !== "/skills") {
      return false;
    }

    return parsed.sources.some(isSkillsPath);
  });
}

export async function injectSkillsCopyInstruction(dockerfilePath: string): Promise<void> {
  const content = await readFile(dockerfilePath, "utf8");
  if (hasSkillsCopyInstructionInFinalStage(content)) {
    return;
  }

  await writeFile(dockerfilePath, content.trimEnd() + "\nCOPY ./skills/ /skills/\n", "utf8");
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
