import { describe, expect, it } from "vitest";

import { createObservabilityProvider } from "./provider.js";

describe("createObservabilityProvider", () => {
  it("returns a provider with tracer and meter from global OTEL API", () => {
    const provider = createObservabilityProvider();

    expect(provider.tracer).toBeDefined();
    expect(provider.meter).toBeDefined();
    // The global API returns no-op implementations when no SDK is registered,
    // but they are still valid Tracer/Meter objects.
    expect(typeof provider.tracer.startSpan).toBe("function");
    expect(typeof provider.meter.createCounter).toBe("function");
  });

  it("accepts a partial override for tracer", () => {
    const customTracer = createObservabilityProvider().tracer;
    const provider = createObservabilityProvider({ tracer: customTracer });

    expect(provider.tracer).toBe(customTracer);
    expect(provider.meter).toBeDefined();
  });

  it("accepts a partial override for meter", () => {
    const customMeter = createObservabilityProvider().meter;
    const provider = createObservabilityProvider({ meter: customMeter });

    expect(provider.meter).toBe(customMeter);
    expect(provider.tracer).toBeDefined();
  });

  it("accepts full override", () => {
    const base = createObservabilityProvider();
    const provider = createObservabilityProvider({
      tracer: base.tracer,
      meter: base.meter,
    });

    expect(provider.tracer).toBe(base.tracer);
    expect(provider.meter).toBe(base.meter);
  });
});
