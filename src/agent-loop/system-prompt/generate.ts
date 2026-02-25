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

function formatSkillsSection(skills: SkillSummary[]): string {
  const sections = skills.map((skill) => {
    if (skill.content) {
      return `### ${skill.name}\n${skill.content.trim()}`;
    }

    const location = skill.sourcePath.trim();
    if (location.length === 0) {
      throw new Error(`Skill "${skill.name}" is missing sourcePath.`);
    }

    return `- ${skill.name}: ${skill.description} (${location})`;
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
