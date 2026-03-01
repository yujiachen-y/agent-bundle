import { trace, metrics } from "@opentelemetry/api";

import type { ObservabilityProvider } from "./types.js";

const LIBRARY_NAME = "agent-bundle";
const LIBRARY_VERSION = process.env.npm_package_version ?? "0.1.0";

/**
 * Create an {@link ObservabilityProvider} from the OpenTelemetry global API.
 *
 * If no SDK is registered the returned tracer/meter are no-ops (zero overhead).
 * Callers can also supply an explicit provider to override the globals.
 */
export function createObservabilityProvider(
  override?: Partial<ObservabilityProvider>,
): ObservabilityProvider {
  return {
    tracer:
      override?.tracer ??
      trace.getTracer(LIBRARY_NAME, LIBRARY_VERSION),
    meter:
      override?.meter ??
      metrics.getMeter(LIBRARY_NAME, LIBRARY_VERSION),
  };
}
