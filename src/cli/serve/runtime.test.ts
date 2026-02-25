import { expect, it } from "vitest";

import type { BundleConfig } from "../../schema/bundle.js";
import {
  parseKeyValueEntries,
  resolveInitVariables,
  resolveMcpTokens,
  resolveServeSandboxConfig,
  resolveServeInputs,
} from "./runtime.js";

function createBaseConfig(): BundleConfig {
  return {
    name: "invoice-processor",
    model: {
      provider: "openai",
      model: "gpt-5-mini",
    },
    prompt: {
      system: "You are concise.",
      variables: [],
    },
    sandbox: {
      provider: "kubernetes",
      timeout: 900,
      resources: {
        cpu: 2,
        memory: "512MB",
      },
      kubernetes: {
        image: "agent-bundle/execd:latest",
      },
    },
    skills: [
      {
        path: "./skills/format-code",
      },
    ],
  };
}

it("parseKeyValueEntries supports comma-separated and repeated entries", () => {
  const parsed = parseKeyValueEntries(["a=1,b=2", "c=3"], "--var");
  expect(parsed).toEqual({
    a: "1",
    b: "2",
    c: "3",
  });
});

it("parseKeyValueEntries accepts empty values", () => {
  const parsed = parseKeyValueEntries("debug=", "--var");
  expect(parsed).toEqual({
    debug: "",
  });
});

it("parseKeyValueEntries rejects malformed entries", () => {
  expect(() => parseKeyValueEntries("=x", "--var")).toThrow("non-empty key");
  expect(() => parseKeyValueEntries("missing-separator", "--var")).toThrow("non-empty key");
});

it("resolveInitVariables applies cli override and supports empty env values", () => {
  const variables = resolveInitVariables(
    ["user_name", "region"],
    { region: "cn" },
    {
      user_name: "",
      AGENT_BUNDLE_VAR_REGION: "us",
    },
  );

  expect(variables).toEqual({
    user_name: "",
    region: "cn",
  });
});

it("resolveInitVariables rejects unknown cli variables", () => {
  expect(() =>
    resolveInitVariables(["allowed"], { unknown: "x" }, {}),
  ).toThrow("Unknown --var entries: unknown");
});

it("resolveInitVariables errors on missing required variables", () => {
  expect(() =>
    resolveInitVariables(["user_name"], {}, {}),
  ).toThrow("Missing required init variables: user_name");
});

it("resolveMcpTokens prefers cli entries then env prefixes", () => {
  const tokens = resolveMcpTokens(
    [
      { name: "refund-service", url: "https://example.com/refund", auth: "bearer" },
      { name: "ops", url: "https://example.com/ops", auth: "bearer" },
    ],
    { "refund-service": "cli-token" },
    {
      AGENT_BUNDLE_MCP_TOKEN_REFUND_SERVICE: "env-prefixed",
      MCP_TOKEN_OPS: "env-fallback",
    },
  );

  expect(tokens).toEqual({
    "refund-service": "cli-token",
    ops: "env-fallback",
  });
});

it("resolveMcpTokens rejects unknown cli server names", () => {
  expect(() =>
    resolveMcpTokens(
      [{ name: "known", url: "https://example.com/mcp", auth: "bearer" }],
      { unknown: "x" },
      {},
    ),
  ).toThrow("Unknown --mcp-token entries: unknown");
});

it("resolveServeSandboxConfig applies serve provider override", () => {
  const sandbox = resolveServeSandboxConfig({
    provider: "e2b",
    timeout: 900,
    resources: { cpu: 2, memory: "512MB" },
    e2b: { template: "invoice-template" },
    serve: { provider: "kubernetes" },
  });

  expect(sandbox.provider).toBe("kubernetes");
});

it("resolveServeInputs resolves absolute config path and passes bundle dirname", async () => {
  const config = createBaseConfig();
  const loadConfig = async (configPath: string): Promise<BundleConfig> => {
    expect(configPath).toBe("/tmp/workspace/agent-bundle.yaml");
    return config;
  };
  const loadSkills = async (
    entries: BundleConfig["skills"],
    bundleDir: string,
  ): Promise<Array<{ name: string; description: string; sourcePath: string }>> => {
    expect(entries).toEqual(config.skills);
    expect(bundleDir).toBe("/tmp/workspace");
    return [
      {
        name: "FormatCode",
        description: "Format files",
        sourcePath: "/tmp/workspace/skills/format-code/SKILL.md",
      },
    ];
  };
  const generatePrompt = (): string => "generated-prompt";

  const resolved = await resolveServeInputs(
    "/tmp/workspace/agent-bundle.yaml",
    loadConfig,
    loadSkills as unknown as Parameters<typeof resolveServeInputs>[2],
    generatePrompt,
  );

  expect(resolved.configPath).toBe("/tmp/workspace/agent-bundle.yaml");
  expect(resolved.config).toBe(config);
  expect(resolved.systemPrompt).toBe("generated-prompt");
  expect(resolved.commands).toEqual([]);
});
