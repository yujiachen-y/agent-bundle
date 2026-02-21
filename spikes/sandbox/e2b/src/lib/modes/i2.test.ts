import { describe, expect, it } from "vitest";

import type { BuildInfo } from "e2b";

import { buildTemplateName, resolveTemplateRef } from "./i2.js";

describe("buildTemplateName", () => {
  it("uses the expected prefix", () => {
    expect(buildTemplateName(1234)).toBe("agent-bundle-spike-1234");
  });
});

describe("resolveTemplateRef", () => {
  it("keeps names that already include a tag", () => {
    const buildInfo = {
      alias: "alias",
      templateId: "template-id",
      buildId: "build-id",
      name: "org/template:stable",
      tags: ["stable"],
    } as BuildInfo;

    expect(resolveTemplateRef(buildInfo)).toBe("org/template:stable");
  });

  it("appends first tag when the template name has no tag", () => {
    const buildInfo = {
      alias: "alias",
      templateId: "template-id",
      buildId: "build-id",
      name: "org/template",
      tags: ["latest", "v2"],
    } as BuildInfo;

    expect(resolveTemplateRef(buildInfo)).toBe("org/template:latest");
  });

  it("falls back to latest tag when none are provided", () => {
    const buildInfo = {
      alias: "alias",
      templateId: "template-id",
      buildId: "build-id",
      name: "org/template",
      tags: [],
    } as BuildInfo;

    expect(resolveTemplateRef(buildInfo)).toBe("org/template:latest");
  });
});
