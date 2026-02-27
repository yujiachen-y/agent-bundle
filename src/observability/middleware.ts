import type { Context, Next } from "hono";

import { createHttpMetrics, type HttpMetrics } from "./metrics.js";
import { elapsed, now, withSpan } from "./tracing.js";
import { HttpAttributes, type ObservabilityProvider } from "./types.js";

/**
 * Hono middleware that records HTTP request duration, active-request count,
 * and wraps each request in a trace span.
 *
 * Usage:
 * ```ts
 * app.use("*", observabilityMiddleware(provider));
 * ```
 */
export function observabilityMiddleware(provider: ObservabilityProvider) {
  const httpMetrics: HttpMetrics = createHttpMetrics(provider.meter);

  return async function otelMiddleware(c: Context, next: Next): Promise<void> {
    const method = c.req.method;
    const path = c.req.path;

    const startMs = now();
    httpMetrics.activeRequests.add(1, { [HttpAttributes.METHOD]: method });

    try {
      await withSpan(
        provider.tracer,
        `HTTP ${method}`,
        {
          [HttpAttributes.METHOD]: method,
          [HttpAttributes.URL_PATH]: path,
        },
        async (span) => {
          await next();

          const route = c.req.routePath;
          span.setAttributes({
            [HttpAttributes.STATUS_CODE]: c.res.status,
            [HttpAttributes.ROUTE]: route,
          });
        },
      );
    } finally {
      const status = c.res.status;
      const route = c.req.routePath;
      httpMetrics.requestDuration.record(elapsed(startMs), {
        [HttpAttributes.METHOD]: method,
        [HttpAttributes.STATUS_CODE]: status,
        [HttpAttributes.ROUTE]: route,
      });
      httpMetrics.activeRequests.add(-1, { [HttpAttributes.METHOD]: method });
    }
  };
}
