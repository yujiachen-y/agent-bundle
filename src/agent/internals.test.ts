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
  it("accepts CLAUDE_CODE_OAUTH_TOKEN for anthropic provider", () => {
    RESTORES.push(
      withTemporaryEnv({
        ANTHROPIC_OAUTH_TOKEN: undefined,
        ANTHROPIC_API_KEY: undefined,
        CLAUDE_CODE_OAUTH_TOKEN: "claude-code-oauth-token",
      }),
    );

    expect(() => {
      validateModelApiKey("anthropic");
    }).not.toThrow();
    expect(process.env.ANTHROPIC_OAUTH_TOKEN).toBe("claude-code-oauth-token");
  });

  it("includes CLAUDE_CODE_OAUTH_TOKEN in missing credential error", () => {
    RESTORES.push(
      withTemporaryEnv({
        ANTHROPIC_OAUTH_TOKEN: undefined,
        ANTHROPIC_API_KEY: undefined,
        CLAUDE_CODE_OAUTH_TOKEN: undefined,
      }),
    );

    expect(() => {
      validateModelApiKey("anthropic");
    }).toThrow(
      'Missing credentials for provider "anthropic". Set ANTHROPIC_OAUTH_TOKEN or CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY before starting the agent.',
    );
  });
});
