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

describe("parseBundleConfig", () => {
  it("parses a valid bundle config", () => {
    const config = parseBundleConfig(makeBaseConfig());

    expect(config.name).toBe("invoice-processor");
    expect(config.model.provider).toBe("anthropic");
    expect(config.sandbox.provider).toBe("e2b");
    expect(config.skills).toHaveLength(1);
  });

  it("parses ollama model overrides", () => {
    const config = makeBaseConfig();
    config.model = {
      provider: "ollama",
      model: "qwen2.5-coder",
      ollama: {
        baseUrl: "http://localhost:11434",
        contextWindow: 16_384,
        maxTokens: 4_096,
      },
    };

    const parsed = parseBundleConfig(config);
    expect(parsed.model.provider).toBe("ollama");
    expect(parsed.model.ollama?.baseUrl).toBe("http://localhost:11434");
    expect(parsed.model.ollama?.contextWindow).toBe(16_384);
    expect(parsed.model.ollama?.maxTokens).toBe(4_096);
  });

  it("rejects missing required fields", () => {
    const config = makeBaseConfig();
    delete (config as { model?: unknown }).model;

    expect(() => parseBundleConfig(config)).toThrowError();
  });

  it("rejects invalid providers", () => {
    const config = makeBaseConfig() as {
      model: {
        provider: string;
        model: string;
      };
    };
    config.model.provider = "invalid-provider";

    expect(() => parseBundleConfig(config)).toThrowError();
  });

  it("rejects invalid ollama model overrides", () => {
    const config = makeBaseConfig() as {
      model: {
        provider: "ollama";
        model: string;
        ollama: {
          baseUrl: string;
          contextWindow: number;
          maxTokens: number;
        };
      };
    };
    config.model = {
      provider: "ollama",
      model: "qwen2.5-coder",
      ollama: {
        baseUrl: "not-a-url",
        contextWindow: 0,
        maxTokens: -1,
      },
    };

    expect(() => parseBundleConfig(config)).toThrowError();
  });

  it("discriminates skill entry union variants", () => {
    const config = makeBaseConfig();
    config.skills = [
      { path: "./skills/local" },
      { github: "acme/invoice-skills", skill: "extract", ref: "release" },
      { url: "https://example.com/skills/ocr", version: "1.2.0" },
    ];

    const parsed = parseBundleConfig(config);
    const githubSkill = parsed.skills[1];

    expect("github" in githubSkill).toBe(true);
    expect("path" in githubSkill).toBe(false);
    expect("url" in githubSkill).toBe(false);
  });

  it("applies sandbox defaults", () => {
    const parsed = parseBundleConfig(makeBaseConfig());

    expect(parsed.sandbox.timeout).toBe(900);
    expect(parsed.sandbox.resources).toEqual({
      cpu: 2,
      memory: "512MB",
    });
  });

});

describe("parseBundleConfig sandbox and MCP validation", () => {
  it("rejects partial sandbox resources overrides", () => {
    const config = makeBaseConfig() as {
      sandbox: {
        provider: "e2b";
        resources?: {
          cpu?: number;
          memory?: string;
        };
      };
    };
    config.sandbox.resources = { cpu: 4 };

    expect(() => parseBundleConfig(config)).toThrowError();
  });

  it("parses valid MCP server configuration", () => {
    const config = makeBaseConfig();
    config.mcp = {
      servers: [
        {
          name: "refund-service",
          url: "https://internal.example.com/mcp/refund",
          auth: "bearer",
        },
      ],
    };

    const parsed = parseBundleConfig(config);
    expect(parsed.mcp?.servers).toHaveLength(1);
    expect(parsed.mcp?.servers[0].name).toBe("refund-service");
  });

  it("rejects invalid MCP server auth type", () => {
    const config = makeBaseConfig() as {
      mcp?: {
        servers: Array<{
          name: string;
          url: string;
          auth: string;
        }>;
      };
    };
    config.mcp = {
      servers: [
        {
          name: "refund-service",
          url: "https://internal.example.com/mcp/refund",
          auth: "api-key",
        },
      ],
    };

    expect(() => parseBundleConfig(config)).toThrowError();
  });
});

describe("parseBundleConfig plugin validation", () => {
  it("parses valid plugin entries", () => {
    const config = makeBaseConfig();
    config.plugins = [
      {
        marketplace: "anthropics/knowledge-work-plugins",
        name: "finance",
        skills: ["variance-analysis", "month-end-close"],
      },
    ];

    const parsed = parseBundleConfig(config);
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins?.[0].marketplace).toBe("anthropics/knowledge-work-plugins");
    expect(parsed.plugins?.[0].ref).toBe("main");
    expect(parsed.plugins?.[0].skills).toEqual(["variance-analysis", "month-end-close"]);
  });

  it("applies default ref for plugins", () => {
    const config = makeBaseConfig();
    config.plugins = [
      {
        marketplace: "anthropics/knowledge-work-plugins",
        name: "finance",
      },
    ];

    const parsed = parseBundleConfig(config);
    expect(parsed.plugins?.[0].ref).toBe("main");
  });

  it("allows custom ref for plugins", () => {
    const config = makeBaseConfig();
    config.plugins = [
      {
        marketplace: "anthropics/knowledge-work-plugins",
        name: "finance",
        ref: "v2.0",
      },
    ];

    const parsed = parseBundleConfig(config);
    expect(parsed.plugins?.[0].ref).toBe("v2.0");
  });

  it("rejects invalid marketplace format", () => {
    const config = makeBaseConfig();
    config.plugins = [
      {
        marketplace: "invalid-no-slash",
        name: "finance",
      },
    ];

    expect(() => parseBundleConfig(config)).toThrowError(/owner\/repo format/);
  });

  it("allows config without plugins field", () => {
    const config = makeBaseConfig();
    const parsed = parseBundleConfig(config);
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

    const noCommands = parseBundleConfig(makeBaseConfig());
    expect(noCommands.commands).toBeUndefined();
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
});
