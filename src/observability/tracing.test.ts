import { trace } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";

import { elapsed, now, recordSpanError, withSpan } from "./tracing.js";

const tracer = trace.getTracer("test-tracing");

describe("withSpan", () => {
  it("returns the result of the function", async () => {
    const result = await withSpan(tracer, "test-op", {}, async () => {
      return 42;
    });

    expect(result).toBe(42);
  });

  it("re-throws errors from the function", async () => {
    await expect(
      withSpan(tracer, "failing-op", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("passes the span to the callback", async () => {
    let receivedSpan = false;

    await withSpan(tracer, "span-check", {}, async (span) => {
      receivedSpan = span !== undefined && span !== null;
    });

    expect(receivedSpan).toBe(true);
  });

  it("accepts attributes", async () => {
    const result = await withSpan(
      tracer,
      "attr-op",
      { "test.key": "value" },
      async () => "ok",
    );

    expect(result).toBe("ok");
  });
});

describe("recordSpanError", () => {
  it("handles Error instances", () => {
    tracer.startActiveSpan("error-span", (span) => {
      // Should not throw
      recordSpanError(span, new Error("test error"));
      span.end();
    });
  });

  it("handles non-Error values", () => {
    tracer.startActiveSpan("string-error-span", (span) => {
      // Should not throw
      recordSpanError(span, "plain string error");
      span.end();
    });
  });
});

describe("now", () => {
  it("returns a positive monotonic timestamp", () => {
    const t = now();
    expect(t).toBeGreaterThan(0);
  });
});

describe("elapsed", () => {
  it("returns a non-negative duration", () => {
    const start = now();
    const duration = elapsed(start);

    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("returns the correct elapsed time", () => {
    const start = performance.now() - 100;
    const duration = elapsed(start);

    expect(duration).toBeGreaterThanOrEqual(99);
    expect(duration).toBeLessThan(500);
  });
});
