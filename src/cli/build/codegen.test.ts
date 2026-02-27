import { describe, expect, it } from "vitest";

import { parseBundleConfig } from "../../schema/bundle.js";
import {
  applySandboxImageRef,
  createResolvedBundleConfig,
  generateIndexSource,
  generatePackageJsonSource,
  generateSources,
  generateTypesSource,
  toCamelCase,
  toPascalCase,
} from "./codegen.js";

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
          transport: "http",
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
  it("generates package.json with scoped package name and runtime dependency", () => {
    const source = generatePackageJsonSource("invoice-processor");
    const parsed = JSON.parse(source) as {
      name: string;
      type: string;
      main: string;
      types: string;
      dependencies: Record<string, string>;
    };

    expect(parsed.name).toBe("@agent-bundle/invoice-processor");
    expect(parsed.type).toBe("module");
    expect(parsed.main).toBe("./index.ts");
    expect(parsed.types).toBe("./index.ts");
    expect(parsed.dependencies).toEqual({ "agent-bundle": "*" });
  });

  it("generates index.ts, types.ts, bundle.json and package.json", () => {
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

    const parsedPkg = JSON.parse(sources.packageJsonSource) as { name: string };
    expect(parsedPkg.name).toBe("@agent-bundle/invoice-processor");
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

describe("build code generation commands in bundle.json", () => {
  it("includes commands in bundle.json when provided", () => {
    const config = createBaseConfig();
    const resolved = createResolvedBundleConfig({
      config,
      systemPrompt: "You are helpful.",
      skills: [],
      commands: [
        {
          name: "Quick Analysis",
          description: "Run a quick financial analysis.",
          argumentHint: "<ticker>",
          sourcePath: "./commands/quick-analysis",
        },
        {
          name: "Reconciliation",
          description: "",
          sourcePath: "./commands/reconciliation",
        },
      ],
      sandboxImage: {
        provider: "kubernetes",
        ref: "registry.local/invoice:abc123",
      },
    });

    const sources = generateSources(resolved, defaultCommandContents());
    const parsedBundle = JSON.parse(sources.bundleJsonSource) as {
      commands: Array<{ name: string; description: string; argumentHint?: string; sourcePath: string }>;
    };

    expect(parsedBundle.commands).toHaveLength(2);
    expect(parsedBundle.commands[0]).toEqual({
      name: "Quick Analysis",
      description: "Run a quick financial analysis.",
      argumentHint: "<ticker>",
      sourcePath: "./commands/quick-analysis",
    });
    expect(parsedBundle.commands[1]).toEqual({
      name: "Reconciliation",
      description: "",
      sourcePath: "./commands/reconciliation",
    });
  });
});

describe("toCamelCase", () => {
  it("converts space-separated names", () => {
    expect(toCamelCase("Quick Analysis")).toBe("quickAnalysis");
  });

  it("converts single-word names", () => {
    expect(toCamelCase("Reconciliation")).toBe("reconciliation");
  });

  it("converts kebab-case names", () => {
    expect(toCamelCase("data-export")).toBe("dataExport");
  });

  it("handles mixed spaces and hyphens", () => {
    expect(toCamelCase("run full-report")).toBe("runFullReport");
  });

  it("returns empty string for empty input", () => {
    expect(toCamelCase("")).toBe("");
  });

  it("throws for names producing invalid identifiers", () => {
    expect(() => toCamelCase("123 bad")).toThrowError('produces invalid identifier');
  });
});

function createResolvedWithCommands() {
  const config = createBaseConfig();
  return createResolvedBundleConfig({
    config,
    systemPrompt: "You are helpful.",
    skills: [],
    commands: [
      {
        name: "Quick Analysis",
        description: "Run a quick financial analysis.",
        argumentHint: "<ticker>",
        sourcePath: "./commands/quick-analysis",
      },
      {
        name: "Reconciliation",
        description: "",
        sourcePath: "./commands/reconciliation",
      },
    ],
    sandboxImage: { provider: "kubernetes", ref: "registry.local/invoice:abc123" },
  });
}

function defaultCommandContents(): Map<string, string> {
  return new Map([
    ["Quick Analysis", "Analyze $ARGUMENTS quickly"],
    ["Reconciliation", "Run reconciliation on $ARGUMENTS"],
  ]);
}

describe("command codegen index.ts", () => {
  it("generates withCommands wrapper when commands are present", () => {
    const resolved = createResolvedWithCommands();
    const source = generateIndexSource(resolved, defaultCommandContents());

    expect(source).toContain("withCommands");
    expect(source).toContain("_factory");
    expect(source).toContain("_commandDefs");
    expect(source).toContain("quickAnalysis");
    expect(source).toContain("reconciliation");
    expect(source).toContain("Analyze $ARGUMENTS quickly");
    expect(source).toContain("InvoiceProcessorCommands");
  });

  it("generates command type interface", () => {
    const source = generateIndexSource(createResolvedWithCommands(), defaultCommandContents());
    expect(source).toContain("export type InvoiceProcessorCommands");
    expect(source).toContain("quickAnalysis(args?: string): Promise<ResponseOutput>");
    expect(source).toContain("reconciliation(args?: string): Promise<ResponseOutput>");
  });

  it("generates agent type alias", () => {
    const source = generateIndexSource(createResolvedWithCommands(), defaultCommandContents());
    expect(source).toContain("export type InvoiceProcessorAgent = Agent & InvoiceProcessorCommands");
  });

  it("wraps factory init with explicit return type", () => {
    const source = generateIndexSource(createResolvedWithCommands(), defaultCommandContents());
    expect(source).toContain("export const InvoiceProcessor = {");
    expect(source).toContain("..._factory");
    expect(source).toContain("_factory.init(options)");
    expect(source).toContain("withCommands<InvoiceProcessorCommands>");
    expect(source).toContain("Promise<Agent & InvoiceProcessorCommands>");
  });

  it("produces unchanged output without commands", () => {
    const config = createBaseConfig();
    const resolved = createResolvedBundleConfig({
      config,
      systemPrompt: "You are helpful.",
      skills: [],
      sandboxImage: { provider: "kubernetes", ref: "registry.local/invoice:abc123" },
    });
    const source = generateIndexSource(resolved);
    expect(source).toContain("export const InvoiceProcessor = defineAgent");
    expect(source).not.toContain("withCommands");
    expect(source).not.toContain("_factory");
    expect(source).not.toContain("_commandDefs");
  });
});

describe("command codegen types.ts", () => {
  it("generates command types when commands are present", () => {
    const source = generateTypesSource(createResolvedWithCommands());
    expect(source).toContain("export interface InvoiceProcessorVariables");
    expect(source).toContain("export type InvoiceProcessorCommands");
    expect(source).toContain("export type InvoiceProcessorAgent = Agent & InvoiceProcessorCommands");
    expect(source).toContain('import type { Agent, ResponseOutput } from "agent-bundle/runtime"');
  });

  it("does not generate command types without commands", () => {
    const config = createBaseConfig();
    const resolved = createResolvedBundleConfig({
      config,
      systemPrompt: "You are helpful.",
      skills: [],
      sandboxImage: { provider: "kubernetes", ref: "registry.local/invoice:abc123" },
    });
    const source = generateTypesSource(resolved);
    expect(source).toContain("export interface InvoiceProcessorVariables");
    expect(source).not.toContain("InvoiceProcessorCommands");
    expect(source).not.toContain("InvoiceProcessorAgent");
  });
});
