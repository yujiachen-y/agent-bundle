import { afterEach, describe, expect, it } from "vitest";

import { assertApiKey } from "./env.js";

const ORIGINAL_E2B_KEY = process.env.E2B_API_KEY;

afterEach(() => {
  if (ORIGINAL_E2B_KEY === undefined) {
    delete process.env.E2B_API_KEY;
    return;
  }

  process.env.E2B_API_KEY = ORIGINAL_E2B_KEY;
});

describe("assertApiKey", () => {
  it("does not throw when E2B_API_KEY exists", () => {
    process.env.E2B_API_KEY = "test-key";
    expect(() => assertApiKey("/tmp/.env")).not.toThrow();
  });

  it("throws when E2B_API_KEY is missing", () => {
    delete process.env.E2B_API_KEY;
    expect(() => assertApiKey("/tmp/.env")).toThrowError("Missing E2B_API_KEY. Expected in /tmp/.env");
  });
});
