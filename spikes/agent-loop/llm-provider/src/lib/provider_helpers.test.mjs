import { describe, expect, it } from "vitest";
import { buildProviderInventory, ENV_VAR_HINTS, pickModelId } from "./provider_helpers.mjs";

describe("pickModelId", () => {
  it("throws when no models exist", () => {
    expect(() => pickModelId("openai", [])).toThrow("No models found for provider: openai");
  });

  it("selects a preferred model when available", () => {
    const models = [{ id: "gpt-4o-mini-2025" }, { id: "gpt-5-mini-2026" }];
    expect(pickModelId("openai", models)).toBe("gpt-5-mini-2026");
  });

  it("falls back to first model for unknown providers", () => {
    const models = [{ id: "model-a" }, { id: "model-b" }];
    expect(pickModelId("custom-provider", models)).toBe("model-a");
  });
});

describe("buildProviderInventory", () => {
  it("builds sorted inventory with model counts, oauth flags and hints", () => {
    const providers = ["zeta", "openai", "alpha"];
    const oauthProviderIds = ["openai", "alpha"];
    const modelMap = {
      alpha: [{ id: "alpha-1" }],
      openai: [{ id: "gpt-5-mini" }, { id: "gpt-4.1-mini" }],
      zeta: [],
    };

    const inventory = buildProviderInventory({
      providers,
      oauthProviderIds,
      getModelsForProvider: (provider) => modelMap[provider],
    });

    expect(inventory).toEqual([
      {
        provider: "alpha",
        modelCount: 1,
        oauth: true,
        envOrCredentialHints: null,
      },
      {
        provider: "openai",
        modelCount: 2,
        oauth: true,
        envOrCredentialHints: ENV_VAR_HINTS.openai,
      },
      {
        provider: "zeta",
        modelCount: 0,
        oauth: false,
        envOrCredentialHints: null,
      },
    ]);
  });

  it("uses custom hint map when provided", () => {
    const inventory = buildProviderInventory({
      providers: ["foo"],
      oauthProviderIds: [],
      getModelsForProvider: () => [{ id: "foo-1" }],
      envVarHints: { foo: "FOO_TOKEN" },
    });

    expect(inventory[0].envOrCredentialHints).toBe("FOO_TOKEN");
  });
});
