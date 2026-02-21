import { parse as parseYaml } from "yaml";

/**
 * @typedef {{ frontmatter: Record<string, unknown>, body: string }} ParsedFrontmatter
 */

/**
 * Parse YAML frontmatter from markdown text.
 * @param {string} content
 * @returns {ParsedFrontmatter}
 */
export function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const yamlChunk = match[1];
  const body = normalized.slice(match[0].length).trim();
  const parsed = parseYaml(yamlChunk);
  return {
    frontmatter: parsed && typeof parsed === "object" ? parsed : {},
    body,
  };
}
