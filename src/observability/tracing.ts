import { SpanStatusCode, type Attributes, type Span, type Tracer } from "@opentelemetry/api";

/**
 * Run `fn` inside a new span. The span is ended automatically and any thrown
 * error is recorded before re-throwing.
 */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Record an error on an existing span without ending it.
 */
export function recordSpanError(span: Span, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message });

  if (error instanceof Error) {
    span.recordException(error);
  }
}

/** Return milliseconds elapsed since `startMs` (monotonic clock). */
export function elapsed(startMs: number): number {
  return performance.now() - startMs;
}

/** Return a monotonic timestamp in milliseconds. */
export function now(): number {
  return performance.now();
}
