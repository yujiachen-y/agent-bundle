import { describe, expect, it } from "vitest";

import { parseBundleConfig } from "./bundle.js";

function makeBaseConfig() {
  return {
    name: "invoice-processor",
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    },
    prompt: {
      system: "You are helpful.",
      variables: ["user_name"],
    },
    sandbox: {
      provider: "e2b",
    },
    skills: [{ path: "./skills/extract" }],
  };
}

describe("parseBundleConfig plugin validation", () => {
  it("parses valid plugin entries", () => {
    const config = makeBaseConfig();
    config.plugins = [{
      marketplace: "anthropics/knowledge-work-plugins",
      name: "finance",
      skills: ["variance-analysis", "month-end-close"],
    }];

    const parsed = parseBundleConfig(config);
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins?.[0].marketplace).toBe("anthropics/knowledge-work-plugins");
    expect(parsed.plugins?.[0].ref).toBe("main");
    expect(parsed.plugins?.[0].skills).toEqual(["variance-analysis", "month-end-close"]);
  });

  it("applies default ref for plugins", () => {
    const config = makeBaseConfig();
    config.plugins = [{ marketplace: "anthropics/knowledge-work-plugins", name: "finance" }];

    const parsed = parseBundleConfig(config);
    expect(parsed.plugins?.[0].ref).toBe("main");
  });

  it("allows custom ref for plugins", () => {
    const config = makeBaseConfig();
    config.plugins = [{
      marketplace: "anthropics/knowledge-work-plugins",
      name: "finance",
      ref: "v2.0",
    }];

    const parsed = parseBundleConfig(config);
    expect(parsed.plugins?.[0].ref).toBe("v2.0");
  });

  it("rejects invalid marketplace format", () => {
    const config = makeBaseConfig();
    config.plugins = [{ marketplace: "invalid-no-slash", name: "finance" }];

    expect(() => parseBundleConfig(config)).toThrowError(/owner\/repo format/);
  });

  it("allows config without plugins field", () => {
    const parsed = parseBundleConfig(makeBaseConfig());
    expect(parsed.plugins).toBeUndefined();
  });
});

describe("parseBundleConfig commands and plugin commands filter", () => {
  it("parses all command entry variants and allows omission", () => {
    const config = makeBaseConfig();
    config.commands = [
      { path: "./commands/local" },
      { github: "acme/commands-repo", ref: "main" },
      { url: "https://example.com/commands/remote.md" },
    ];

    const parsed = parseBundleConfig(config);
    expect(parsed.commands).toHaveLength(3);
    expect("path" in parsed.commands![0]).toBe(true);
    expect("github" in parsed.commands![1]).toBe(true);
    expect("url" in parsed.commands![2]).toBe(true);
    expect(parseBundleConfig(makeBaseConfig()).commands).toBeUndefined();
  });

  it("parses plugin entries with commands filter", () => {
    const config = makeBaseConfig();
    config.plugins = [{
      marketplace: "anthropics/knowledge-work-plugins",
      name: "finance",
      skills: ["variance-analysis"],
      commands: ["journal-entry", "reconciliation"],
    }];

    const parsed = parseBundleConfig(config);
    expect(parsed.plugins?.[0].commands).toEqual(["journal-entry", "reconciliation"]);
    expect(parsed.plugins?.[0].skills).toEqual(["variance-analysis"]);
  });

  it("allows plugin entries without commands filter", () => {
    const config = makeBaseConfig();
    config.plugins = [{ marketplace: "anthropics/knowledge-work-plugins", name: "finance" }];

    const parsed = parseBundleConfig(config);
    expect(parsed.plugins?.[0].commands).toBeUndefined();
  });
});

describe("parseBundleConfig sandbox build validation", () => {
  it("parses kubernetes build config with and without context", () => {
    const withContext = makeBaseConfig();
    withContext.sandbox = {
      provider: "kubernetes",
      kubernetes: { image: "agent-bundle/execd:latest", build: { dockerfile: "./Dockerfile", context: "." } },
    };
    const p1 = parseBundleConfig(withContext);
    expect(p1.sandbox.kubernetes?.build?.dockerfile).toBe("./Dockerfile");
    expect(p1.sandbox.kubernetes?.build?.context).toBe(".");

    const withoutContext = makeBaseConfig();
    withoutContext.sandbox = {
      provider: "kubernetes",
      kubernetes: { image: "agent-bundle/execd:latest", build: { dockerfile: "./Dockerfile" } },
    };
    const p2 = parseBundleConfig(withoutContext);
    expect(p2.sandbox.kubernetes?.build?.dockerfile).toBe("./Dockerfile");
    expect(p2.sandbox.kubernetes?.build?.context).toBeUndefined();
  });

  it("parses e2b build config with dockerfile only", () => {
    const config = makeBaseConfig();
    config.sandbox = {
      provider: "e2b",
      e2b: { template: "invoice-processor", build: { dockerfile: "./e2b.Dockerfile" } },
    };
    const parsed = parseBundleConfig(config);
    expect(parsed.sandbox.e2b?.build?.dockerfile).toBe("./e2b.Dockerfile");
    expect(parsed.sandbox.e2b?.build?.context).toBeUndefined();
  });

  it("parses docker build config with and without context", () => {
    const withContext = makeBaseConfig();
    withContext.sandbox = {
      provider: "docker",
      docker: { image: "agent-bundle/execd:latest", build: { dockerfile: "./Dockerfile", context: "." } },
    };
    const p1 = parseBundleConfig(withContext);
    expect(p1.sandbox.docker?.build?.dockerfile).toBe("./Dockerfile");
    expect(p1.sandbox.docker?.build?.context).toBe(".");

    const withoutContext = makeBaseConfig();
    withoutContext.sandbox = {
      provider: "docker",
      docker: { image: "agent-bundle/execd:latest", build: { dockerfile: "./Dockerfile" } },
    };
    const p2 = parseBundleConfig(withoutContext);
    expect(p2.sandbox.docker?.build?.dockerfile).toBe("./Dockerfile");
    expect(p2.sandbox.docker?.build?.context).toBeUndefined();
  });
});
