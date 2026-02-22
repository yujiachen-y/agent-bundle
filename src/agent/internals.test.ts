import { afterEach, describe, expect, it } from "vitest";

import { validateModelApiKey } from "./internals.js";

type EnvRestore = () => void;

function withTemporaryEnv(updates: Record<string, string | undefined>): EnvRestore {
  const previousValues = Object.fromEntries(
    Object.keys(updates).map((key) => [key, process.env[key]]),
  );

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });

  return () => {
    Object.entries(previousValues).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    });
  };
}

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
