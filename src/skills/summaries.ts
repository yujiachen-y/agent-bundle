import type { SkillSummary } from "../agent-loop/system-prompt/generate.js";

export type SkillSummarySource = {
  name: string;
  description: string;
  sourcePath: string;
  content?: string;
};

export function toSkillSummaries(skills: readonly SkillSummarySource[]): SkillSummary[] {
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    sourcePath: skill.sourcePath,
    content: skill.content,
  }));
}
