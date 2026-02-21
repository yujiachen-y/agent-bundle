import { describe, expect, it } from "vitest";
import {
  buildOAuthCredentialMap,
  buildSkippedTestResult,
  getAssistantText,
  hasTokenCounting,
  withTemporaryEnvVar,
} from "./runtime_helpers.mjs";

describe("getAssistantText", () => {
  it("returns empty string for non-assistant messages", () => {
    expect(getAssistantText(null)).toBe("");
    expect(getAssistantText({ role: "user", content: [] })).toBe("");
  });

  it("joins text chunks and trims whitespace", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "text", text: " hello" },
        { type: "tool_use", id: "1" },
        { type: "text", text: " world " },
      ],
    };

    expect(getAssistantText(message)).toBe("hello world");
  });
});

describe("hasTokenCounting", () => {
  it("returns true only when usage has valid finite token counts", () => {
    expect(hasTokenCounting({ input: 1, output: 2, totalTokens: 3 })).toBe(true);
    expect(hasTokenCounting({ input: 1, output: 2, totalTokens: 0 })).toBe(false);
    expect(hasTokenCounting({ input: 1, output: Number.NaN, totalTokens: 4 })).toBe(false);
    expect(hasTokenCounting(null)).toBe(false);
  });
});

describe("buildOAuthCredentialMap", () => {
  it("returns only oauth credentials without type", () => {
    const auth = {
      openai: { type: "oauth", accessToken: "a" },
      anthropic: { type: "apiKey", apiKey: "b" },
      invalid: "x",
    };

    expect(buildOAuthCredentialMap(auth)).toEqual({
      openai: { accessToken: "a" },
    });
  });

  it("handles invalid auth payload", () => {
    expect(buildOAuthCredentialMap(undefined)).toEqual({});
    expect(buildOAuthCredentialMap("bad-payload")).toEqual({});
  });
});

describe("buildSkippedTestResult", () => {
  it("creates a skipped result payload", () => {
    expect(buildSkippedTestResult("missing key")).toEqual({
      ok: false,
      skipped: true,
      reason: "missing key",
    });
  });
});

describe("withTemporaryEnvVar", () => {
  it("sets env var for callback and restores prior value", async () => {
    process.env.AGENT_BUNDLE_TEST_VAR = "original";

    const result = await withTemporaryEnvVar("AGENT_BUNDLE_TEST_VAR", "temp", async () => {
      expect(process.env.AGENT_BUNDLE_TEST_VAR).toBe("temp");
      return "done";
    });

    expect(result).toBe("done");
    expect(process.env.AGENT_BUNDLE_TEST_VAR).toBe("original");
  });

  it("restores env var even when callback throws", async () => {
    delete process.env.AGENT_BUNDLE_TEST_VAR;

    await expect(withTemporaryEnvVar("AGENT_BUNDLE_TEST_VAR", "temp", async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");

    expect(process.env.AGENT_BUNDLE_TEST_VAR).toBeUndefined();
  });
});
