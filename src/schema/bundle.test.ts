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

describe("parseBundleConfig sandbox validation", () => {
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
});

describe("parseBundleConfig MCP validation", () => {
  it("parses valid MCP server configuration", () => {
    const config = makeBaseConfig();
    config.mcp = {
      servers: [
        {
          transport: "http",
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

  it("parses stdio and sse MCP server configurations", () => {
    const config = makeBaseConfig();
    config.mcp = {
      servers: [
        {
          transport: "stdio",
          name: "local-tool",
          command: "node",
          args: ["server.js"],
          env: { NODE_ENV: "test" },
        },
        {
          transport: "sse",
          name: "events-service",
          url: "https://internal.example.com/mcp/events",
        },
      ],
    };

    const parsed = parseBundleConfig(config);
    expect(parsed.mcp?.servers).toHaveLength(2);
    expect(parsed.mcp?.servers[0]).toMatchObject({
      transport: "stdio",
      name: "local-tool",
    });
    expect(parsed.mcp?.servers[1]).toMatchObject({
      transport: "sse",
      name: "events-service",
    });
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
          transport: "http",
          name: "refund-service",
          url: "https://internal.example.com/mcp/refund",
          auth: "api-key",
        },
      ],
    };

    expect(() => parseBundleConfig(config)).toThrowError();
  });
});

describe("parseBundleConfig MCP transport validation", () => {
  it("rejects unknown MCP transport types", () => {
    const config = makeBaseConfig() as {
      mcp?: {
        servers: Array<Record<string, unknown>>;
      };
    };
    config.mcp = {
      servers: [
        {
          transport: "websocket",
          name: "unsupported",
          url: "https://example.com/mcp",
        },
      ],
    };

    expect(() => parseBundleConfig(config)).toThrowError();
  });
});
