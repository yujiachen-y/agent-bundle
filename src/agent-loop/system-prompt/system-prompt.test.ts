import { describe, expect, it } from "vitest";

import { fillSystemPrompt } from "./fill.js";
import { generateSystemPromptTemplate, type SkillSummary } from "./generate.js";

describe("generateSystemPromptTemplate", () => {
  it("returns base prompt as-is when no skills are provided", () => {
    const template = generateSystemPromptTemplate({
      basePrompt: "You are a helpful assistant.",
      skills: [],
    });

    expect(template).toBe("You are a helpful assistant.");
  });

  it("inlines skill content when content is provided", () => {
    const skills: SkillSummary[] = [
      {
        name: "Extract Line Items",
        description: "Parse invoice rows from OCR output.",
        sourcePath: "/skills/extract-line-items/SKILL.md",
        content: "---\nname: Extract Line Items\n---\n\n# Extract\n\nDo the extraction.",
      },
    ];

    const template = generateSystemPromptTemplate({
      basePrompt: "You are an invoice assistant.",
      skills,
    });

    expect(template).toContain("## Skills");
    expect(template).toContain("### Extract Line Items (/skills/extract-line-items/SKILL.md)");
    expect(template).toContain("Do the extraction.");
  });

  it("falls back to path reference when content is not provided", () => {
    const skills: SkillSummary[] = [
      {
        name: "Extract Line Items",
        description: "Parse invoice rows from OCR output.",
        sourcePath: "/skills/extract-line-items/SKILL.md",
      },
    ];

    const template = generateSystemPromptTemplate({
      basePrompt: "You are an invoice assistant.",
      skills,
    });

    expect(template).toContain("## Skills");
    expect(template).toContain(
      "- Extract Line Items: Parse invoice rows from OCR output. (/skills/extract-line-items/SKILL.md)",
    );
  });

  it("appends multiple skill summaries in stable order", () => {
    const template = generateSystemPromptTemplate({
      basePrompt: "Base prompt",
      skills: [
        {
          name: "Skill One",
          description: "First skill",
          sourcePath: "/skills/skill-one/SKILL.md",
          content: "# Skill One\n\nFirst.",
        },
        {
          name: "Skill Two",
          description: "Second skill",
          sourcePath: "/skills/skill-two/SKILL.md",
          content: "# Skill Two\n\nSecond.",
        },
      ],
    });

    expect(template).toMatch(/Skill One[\s\S]*Skill Two/);
  });

  it("throws when a skill has no content and an empty sourcePath", () => {
    expect(() =>
      generateSystemPromptTemplate({
        basePrompt: "Base prompt",
        skills: [
          {
            name: "Broken skill",
            description: "Invalid path",
            sourcePath: "   ",
          },
        ],
      }),
    ).toThrowError('Skill "Broken skill" is missing sourcePath.');
  });
});

describe("fillSystemPrompt", () => {
  it("fills all declared variables", () => {
    const prompt = fillSystemPrompt(
      "Hello {{user_name}}, timezone {{timezone}}.",
      {
        user_name: "Alice",
        timezone: "UTC+8",
      },
    );

    expect(prompt).toBe("Hello Alice, timezone UTC+8.");
  });

  it("throws when required variables are missing", () => {
    expect(() =>
      fillSystemPrompt("Hello {{user_name}}, timezone {{timezone}}.", {
        user_name: "Alice",
      }),
    ).toThrowError("Missing required prompt variables: timezone");
  });

  it("ignores extra variables not used in the template", () => {
    const prompt = fillSystemPrompt("Hello {{user_name}}.", {
      user_name: "Alice",
      unused: "value",
    });

    expect(prompt).toBe("Hello Alice.");
  });
});
