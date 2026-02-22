import { afterEach, describe, expect, it } from "vitest";

import { withTemporaryEnv, type EnvRestore } from "../test-helpers/env.js";
import { validateModelApiKey } from "./internals.js";

const RESTORES: EnvRestore[] = [];

afterEach(() => {
  RESTORES.splice(0).forEach((restore) => {
    restore();
  });
});

describe("validateModelApiKey", () => {
  it("accepts ANTHROPIC_OAUTH_TOKEN for anthropic provider", () => {
    RESTORES.push(
      withTemporaryEnv({
        ANTHROPIC_OAUTH_TOKEN: "oauth-token",
        ANTHROPIC_API_KEY: undefined,
      }),
    );

    expect(() => {
      validateModelApiKey("anthropic");
    }).not.toThrow();
  });

  it("includes ANTHROPIC credential env names in missing credential error", () => {
    RESTORES.push(
      withTemporaryEnv({
        ANTHROPIC_OAUTH_TOKEN: undefined,
        ANTHROPIC_API_KEY: undefined,
      }),
    );

    expect(() => {
      validateModelApiKey("anthropic");
    }).toThrow(
      'Missing credentials for provider "anthropic". Set ANTHROPIC_OAUTH_TOKEN or ANTHROPIC_API_KEY before starting the agent.',
    );
  });
});
