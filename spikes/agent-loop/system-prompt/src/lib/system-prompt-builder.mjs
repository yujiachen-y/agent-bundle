import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseFrontmatter } from "./frontmatter.mjs";

export const SESSION_CONTEXT_PLACEHOLDER = "{{session_context}}";

const BASE_INSTRUCTIONS = `You are an expert coding agent running in agent-bundle.
Follow user intent, use tools deliberately, and keep outputs concise and precise.
Skills are fixed at build time for this bundle; use the skill list below to decide when to load a full SKILL.md.
If deeper guidance is needed, read the full skill file from the listed path.
All tool operations execute inside the sandbox.`;

const TOOL_LINES = [
  "- Bash: execute shell commands in the sandbox.",
  "- Read: read file contents.",
  "- Write: create or overwrite files.",
  "- Edit: make targeted edits to existing files.",
];

/**
 * @typedef {"description" | "full"} SkillPromptMode
 */

/**
 * @typedef {{
 *  path: string;
 *  prompt: SkillPromptMode;
 * }} BundleSkillEntry
 */

/**
 * @typedef {{
 *  name: string;
 *  description: string;
 *  body: string;
 *  localPath: string;
 *  containerPath: string;
 *  promptMode: SkillPromptMode;
 * }} LoadedSkill
 */

/**
 * @param {string | undefined} raw
 * @returns {SkillPromptMode}
 */
function normalizePromptMode(raw) {
  return raw === "full" ? "full" : "description";
}

/**
 * @param {unknown} value
 * @returns {BundleSkillEntry}
 */
function normalizeBundleSkillEntry(value) {
  if (typeof value === "string") {
    return { path: value, prompt: "description" };
  }

  if (!value || typeof value !== "object") {
    throw new Error("Each skills entry must be a string or an object with { path, prompt? }.");
  }

  const entry = /** @type {{ path?: unknown, prompt?: unknown }} */ (value);
  if (typeof entry.path !== "string" || entry.path.trim() === "") {
    throw new Error("Skill object entry requires a non-empty string `path`.");
  }

  return {
    path: entry.path,
    prompt: normalizePromptMode(typeof entry.prompt === "string" ? entry.prompt : undefined),
  };
}

/**
 * @param {string} bundlePath
 * @returns {Promise<{ bundlePath: string, bundleDir: string, skills: BundleSkillEntry[] }>}
 */
export async function loadBundleConfig(bundlePath) {
  const resolvedBundlePath = resolve(bundlePath);
  const raw = await readFile(resolvedBundlePath, "utf8");
  const parsed = parseYaml(raw);
  const config = parsed && typeof parsed === "object" ? parsed : {};
  const skillsNode = /** @type {{ skills?: unknown }} */ (config).skills;

  if (!Array.isArray(skillsNode)) {
    throw new Error(`Bundle config ${resolvedBundlePath} must include a 'skills' array.`);
  }

  return {
    bundlePath: resolvedBundlePath,
    bundleDir: dirname(resolvedBundlePath),
    skills: skillsNode.map(normalizeBundleSkillEntry),
  };
}

/**
 * @param {string} rawPath
 * @param {string} bundleDir
 * @returns {Promise<string>}
 */
async function resolveSkillMarkdownPath(rawPath, bundleDir) {
  const resolvedPath = isAbsolute(rawPath) ? rawPath : resolve(bundleDir, rawPath);
  const targetStat = await stat(resolvedPath).catch(() => null);

  if (!targetStat) {
    throw new Error(`Skill path does not exist: ${resolvedPath}`);
  }

  if (targetStat.isDirectory()) {
    const skillMdPath = join(resolvedPath, "SKILL.md");
    const skillMdStat = await stat(skillMdPath).catch(() => null);
    if (!skillMdStat || !skillMdStat.isFile()) {
      throw new Error(`Missing SKILL.md in skill directory: ${resolvedPath}`);
    }
    return skillMdPath;
  }

  if (targetStat.isFile()) {
    return resolvedPath;
  }

  throw new Error(`Unsupported skill path type: ${resolvedPath}`);
}

/**
 * @param {string} bundlePath
 * @param {{ forcePromptMode?: "bundle" | SkillPromptMode }} [options]
 * @returns {Promise<LoadedSkill[]>}
 */
export async function loadSkillsFromBundle(bundlePath, options = {}) {
  const bundle = await loadBundleConfig(bundlePath);
  const forcePromptMode = options.forcePromptMode ?? "bundle";

  return Promise.all(
    bundle.skills.map(async (entry) => {
      const skillMdPath = await resolveSkillMarkdownPath(entry.path, bundle.bundleDir);
      const rawSkill = await readFile(skillMdPath, "utf8");
      const { frontmatter, body } = parseFrontmatter(rawSkill);

      const parentDirName = basename(dirname(skillMdPath));
      const rawName = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
      const rawDescription = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
      const name = rawName || parentDirName;
      const description = rawDescription;

      if (!description) {
        throw new Error(`Skill ${skillMdPath} is missing a non-empty frontmatter description.`);
      }

      const promptMode = forcePromptMode === "bundle" ? entry.prompt : forcePromptMode;
      return {
        name,
        description,
        body,
        localPath: skillMdPath,
        containerPath: `/skills/${name}/SKILL.md`,
        promptMode,
      };
    }),
  );
}

/**
 * @param {LoadedSkill} skill
 * @param {"container" | "local" | "none"} locationMode
 * @returns {string}
 */
function formatSkillBlock(skill, locationMode) {
  const location =
    locationMode === "container"
      ? skill.containerPath
      : locationMode === "local"
      ? skill.localPath
      : "";
  const locationLine = location ? `Skill file: ${location}` : "";

  if (skill.promptMode === "full") {
    return [`### ${skill.name} (prompt: full)`, locationLine, skill.body].filter(Boolean).join("\n");
  }

  return [`### ${skill.name}`, skill.description, locationLine].filter(Boolean).join("\n");
}

/**
 * @param {{ skills: LoadedSkill[], locationMode?: "container" | "local" | "none" }} options
 * @returns {string}
 */
export function buildSystemPromptTemplate(options) {
  const locationMode = options.locationMode ?? "container";
  const skillsSection =
    options.skills.length > 0
      ? options.skills.map((skill) => formatSkillBlock(skill, locationMode)).join("\n\n")
      : "(no skills configured)";

  return [
    BASE_INSTRUCTIONS,
    "",
    "## Available Skills",
    "",
    skillsSection,
    "",
    "## Tools",
    ...TOOL_LINES,
    "- All tool operations execute inside the sandbox.",
    "",
    SESSION_CONTEXT_PLACEHOLDER,
  ].join("\n");
}

/**
 * @param {string} bundlePath
 * @param {{ locationMode?: "container" | "local" | "none", forcePromptMode?: "bundle" | SkillPromptMode }} [options]
 * @returns {Promise<{ prompt: string, skills: LoadedSkill[] }>}
 */
export async function generateSystemPromptFromBundle(bundlePath, options = {}) {
  const skills = await loadSkillsFromBundle(bundlePath, {
    forcePromptMode: options.forcePromptMode ?? "bundle",
  });
  const prompt = buildSystemPromptTemplate({
    skills,
    locationMode: options.locationMode ?? "container",
  });
  return { prompt, skills };
}

/**
 * @param {string} outputPath
 * @param {string} prompt
 * @returns {Promise<void>}
 */
export async function writePromptTemplate(outputPath, prompt) {
  const resolvedOutput = resolve(outputPath);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${prompt}\n`, "utf8");
}
