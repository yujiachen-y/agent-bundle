export type SkillSummary = {
  name: string;
  description: string;
  sourcePath: string;
  content?: string;
};

export type GenerateSystemPromptInput = {
  basePrompt: string;
  skills: SkillSummary[];
};

function sanitizeSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "skill";
}

function toSandboxSkillPath(index: number, skillName: string): string {
  const dirName = `${String(index + 1).padStart(2, "0")}-${sanitizeSegment(skillName)}`;
  return `/skills/${dirName}/SKILL.md`;
}

function formatSkillsSection(skills: SkillSummary[]): string {
  const sections = skills.map((skill, index) => {
    const sandboxPath = toSandboxSkillPath(index, skill.name);

    if (skill.content) {
      return `### ${skill.name} (${sandboxPath})\n${skill.content.trim()}`;
    }

    const location = skill.sourcePath.trim();
    if (location.length === 0) {
      throw new Error(`Skill "${skill.name}" is missing sourcePath.`);
    }

    return `- ${skill.name}: ${skill.description} (${sandboxPath})`;
  });

  return ["## Skills", ...sections].join("\n\n");
}

export function generateSystemPromptTemplate(input: GenerateSystemPromptInput): string {
  const trimmedBasePrompt = input.basePrompt.trim();
  if (input.skills.length === 0) {
    return trimmedBasePrompt;
  }

  return [trimmedBasePrompt, formatSkillsSection(input.skills)].join("\n\n");
}
