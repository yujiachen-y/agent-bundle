import { describe, expect, it } from "vitest";

import { toGithubSkillRawUrl } from "./github-resources.js";

describe("toGithubSkillRawUrl", () => {
  it("uses SKILL.md at repo root when skill is omitted", () => {
    const url = toGithubSkillRawUrl({
      github: "acme/skills",
      ref: "main",
    });

    expect(url).toBe("https://raw.githubusercontent.com/acme/skills/main/SKILL.md");
  });

  it("appends /SKILL.md when skill points to a directory", () => {
    const url = toGithubSkillRawUrl({
      github: "acme/skills",
      skill: "team/formatter",
      ref: "main",
    });

    expect(url).toBe("https://raw.githubusercontent.com/acme/skills/main/team/formatter/SKILL.md");
  });

  it("keeps explicit markdown file paths", () => {
    const url = toGithubSkillRawUrl({
      github: "acme/skills",
      skill: "team/formatter/custom.md",
      ref: "main",
    });

    expect(url).toBe("https://raw.githubusercontent.com/acme/skills/main/team/formatter/custom.md");
  });

  it("encodes path segments and ref", () => {
    const url = toGithubSkillRawUrl({
      github: "acme/skills",
      skill: "Folder Name/skill+one",
      ref: "release/v1.0",
    });

    expect(url).toBe(
      "https://raw.githubusercontent.com/acme/skills/release%2Fv1.0/Folder%20Name/skill%2Bone/SKILL.md",
    );
  });
});
