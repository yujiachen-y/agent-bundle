import { describe, expect, it } from "vitest";

import { formatError } from "./errors.js";

describe("formatError", () => {
  it("formats Error instances", () => {
    expect(formatError(new TypeError("boom"))).toBe("TypeError: boom");
  });

  it("stringifies unknown values", () => {
    expect(formatError(123)).toBe("123");
  });
});
