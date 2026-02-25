import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CREATED_DIRS: string[] = [];

export type BundleConfigInput = {
  sandboxLines: string[];
  promptVariables?: string[];
};

export async function createTempWorkspace(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `agent-bundle-${name}-`));
  CREATED_DIRS.push(directory);
  return directory;
}

export async function cleanupTempWorkspaces(): Promise<void> {
  await Promise.all(
    CREATED_DIRS.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
}

export async function writeSkill(workspaceDir: string): Promise<void> {
  const skillPath = join(workspaceDir, "skills", "format-code", "SKILL.md");
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(
    skillPath,
    [
      "---",
      "name: FormatCode",
      "description: Format source code in sandbox",
      "---",
      "Use the formatter.",
      "",
    ].join("\n"),
    "utf8",
  );
}

export function createBundleConfig(input: BundleConfigInput): string {
  const promptVariableLines = input.promptVariables && input.promptVariables.length > 0
    ? ["  variables:", ...input.promptVariables.map((name) => `    - ${name}`)]
    : ["  variables: []"];

  return [
    "name: code-formatter",
    "model:",
    "  provider: anthropic",
    "  model: claude-sonnet-4-20250514",
    "prompt:",
    "  system: You are a formatter.",
    ...promptVariableLines,
    "sandbox:",
    ...input.sandboxLines,
    "skills:",
    "  - path: ./skills/format-code",
  ].join("\n");
}

export async function writeBundleConfig(workspaceDir: string, contents: string): Promise<string> {
  const configPath = join(workspaceDir, "agent-bundle.yaml");
  await writeFile(configPath, contents, "utf8");
  return configPath;
}
