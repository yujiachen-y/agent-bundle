import { describe, expect, it } from "vitest";

import { parseBundleConfig } from "../schema/bundle.js";
import {
  applySandboxImageRef,
  createResolvedBundleConfig,
  generateSources,
  toPascalCase,
} from "./build-codegen.js";

function createBaseConfig() {
  return parseBundleConfig({
    name: "invoice-processor",
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    },
    prompt: {
      system: "You are helpful.",
      variables: ["user_name", "timezone"],
    },
    sandbox: {
      provider: "kubernetes",
      kubernetes: {
        image: "agent-bundle/execd:latest",
      },
    },
    skills: [{ path: "./skills/extract" }],
    mcp: {
      servers: [
        {
          name: "refund-service",
          url: "https://internal.example.com/mcp/refund",
          auth: "bearer",
        },
      ],
    },
  });
}

describe("build code generation naming", () => {
  it("converts kebab-case bundle names to PascalCase", () => {
    expect(toPascalCase("invoice-processor")).toBe("InvoiceProcessor");
    expect(toPascalCase("agent")).toBe("Agent");
  });

  it("rejects empty bundle names for PascalCase conversion", () => {
    expect(() => toPascalCase("")).toThrowError("Bundle name cannot be empty.");
  });
});

describe("build code generation sandbox image refs", () => {
  it("injects kubernetes image into sandbox config", () => {
    const config = createBaseConfig();

    const sandbox = applySandboxImageRef(config.sandbox, {
      provider: "kubernetes",
      ref: "registry.local/invoice:abc123",
    });

    expect(sandbox.provider).toBe("kubernetes");
    expect(sandbox.kubernetes?.image).toBe("registry.local/invoice:abc123");
  });

  it("injects e2b template into sandbox config", () => {
    const config = createBaseConfig();

    const sandbox = applySandboxImageRef(
      {
        ...config.sandbox,
        provider: "e2b",
        e2b: {},
      },
      {
        provider: "e2b",
        ref: "invoice-processor:a3f8c2d",
      },
    );

    expect(sandbox.provider).toBe("e2b");
    expect(sandbox.e2b?.template).toBe("invoice-processor:a3f8c2d");
  });
});

describe("build code generation outputs", () => {
  it("generates index.ts, types.ts and bundle.json", () => {
    const config = createBaseConfig();
    const resolved = createResolvedBundleConfig({
      config,
      systemPrompt: "You are helpful.\n\n## Skills\n- Extract: Parse invoice (./skills/extract)",
      skills: [
        {
          name: "Extract",
          description: "Parse invoice",
          sourcePath: "./skills/extract",
        },
      ],
      sandboxImage: {
        provider: "kubernetes",
        ref: "registry.local/invoice:abc123",
      },
    });

    const sources = generateSources(resolved);

    expect(sources.indexSource).toContain('import { defineAgent } from "agent-bundle/runtime";');
    expect(sources.indexSource).toContain("export const InvoiceProcessor = defineAgent");
    expect(sources.indexSource).toContain('image: "registry.local/invoice:abc123"');
    expect(sources.indexSource).toContain("variables:");
    expect(sources.indexSource).toContain("\"user_name\"");
    expect(sources.indexSource).toContain("\"timezone\"");
    expect(sources.indexSource).toContain("as const");
    expect(sources.typesSource).toContain("export interface InvoiceProcessorVariables");
    expect(sources.typesSource).toContain("user_name: string;");
    expect(sources.typesSource).toContain("timezone: string;");

    const parsedBundle = JSON.parse(sources.bundleJsonSource) as {
      sandboxImage: { provider: string; ref: string };
      skills: Array<{ name: string }>;
      systemPrompt: string;
    };

    expect(parsedBundle.sandboxImage).toEqual({
      provider: "kubernetes",
      ref: "registry.local/invoice:abc123",
    });
    expect(parsedBundle.skills).toEqual([{ name: "Extract", description: "Parse invoice", sourcePath: "./skills/extract" }]);
    expect(parsedBundle.systemPrompt).toContain("## Skills");
  });

  it("quotes object keys that are not valid identifiers", () => {
    const config = createBaseConfig();
    config.sandbox = {
      provider: "kubernetes",
      kubernetes: {
        image: "agent-bundle/execd:latest",
        nodeSelector: {
          "node-selector": "pool-a",
        },
      },
    };
    const resolved = createResolvedBundleConfig({
      config,
      systemPrompt: "You are helpful.",
      skills: [],
      sandboxImage: {
        provider: "kubernetes",
        ref: "agent-bundle/execd:latest",
      },
    });

    const sources = generateSources(resolved);

    expect(sources.indexSource).toContain('"node-selector": "pool-a"');
  });
});
