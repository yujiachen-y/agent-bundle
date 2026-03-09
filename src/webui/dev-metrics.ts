import type { Context, Next } from "hono";

/* ------------------------------------------------------------------ */
/*  Histogram helper                                                   */
/* ------------------------------------------------------------------ */

export type HistogramSnapshot = {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
};

function emptyHistogram(): HistogramSnapshot {
  return { count: 0, sum: 0, min: 0, max: 0, avg: 0 };
}

type HistogramAccumulator = {
  count: number;
  sum: number;
  min: number;
  max: number;
};

function newAccumulator(): HistogramAccumulator {
  return { count: 0, sum: 0, min: Infinity, max: -Infinity };
}

function recordValue(acc: HistogramAccumulator, value: number): void {
  acc.count += 1;
  acc.sum += value;
  if (value < acc.min) acc.min = value;
  if (value > acc.max) acc.max = value;
}

function snapshotHistogram(acc: HistogramAccumulator): HistogramSnapshot {
  if (acc.count === 0) return emptyHistogram();
  return {
    count: acc.count,
    sum: acc.sum,
    min: acc.min,
    max: acc.max,
    avg: acc.sum / acc.count,
  };
}

/* ------------------------------------------------------------------ */
/*  Breakdown tracker (per-name counters)                              */
/* ------------------------------------------------------------------ */

type BreakdownEntry = { count: number; errors: number; duration: HistogramAccumulator };

function newBreakdownEntry(): BreakdownEntry {
  return { count: 0, errors: 0, duration: newAccumulator() };
}

export type BreakdownSnapshot = Record<
  string,
  { readonly count: number; readonly errors: number; readonly avgDurationMs: number }
>;

function snapshotBreakdown(map: Map<string, BreakdownEntry>): BreakdownSnapshot {
  const result: BreakdownSnapshot = {};
  for (const [key, entry] of map) {
    result[key] = {
      count: entry.count,
      errors: entry.errors,
      avgDurationMs: entry.count > 0 ? entry.duration.sum / entry.count : 0,
    };
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Snapshot type                                                      */
/* ------------------------------------------------------------------ */

export type DevMetricsSnapshot = {
  readonly respondCount: number;
  readonly respondErrorCount: number;
  readonly respondDuration: HistogramSnapshot;
  readonly respondActive: number;

  readonly inputTokensTotal: number;
  readonly outputTokensTotal: number;

  readonly toolCallCount: number;
  readonly toolCallErrorCount: number;
  readonly toolCallDuration: HistogramSnapshot;
  readonly toolCallsByName: BreakdownSnapshot;

  readonly mcpCallCount: number;
  readonly mcpCallErrorCount: number;
  readonly mcpCallDuration: HistogramSnapshot;
  readonly mcpCallsByServer: BreakdownSnapshot;

  readonly httpRequestCount: number;
  readonly httpRequestDuration: HistogramSnapshot;
  readonly httpRequestsByRoute: BreakdownSnapshot;

  readonly collectorStartedAt: string;
  readonly snapshotAt: string;
};

/* ------------------------------------------------------------------ */
/*  Collector                                                          */
/* ------------------------------------------------------------------ */

export class DevMetricsCollector {
  private startedAt = new Date().toISOString();

  // Agent lifecycle
  private respondCount = 0;
  private respondErrorCount = 0;
  private respondDuration = newAccumulator();
  private respondActive = 0;

  // Tokens
  private inputTokensTotal = 0;
  private outputTokensTotal = 0;

  // Tool calls
  private toolCallCount = 0;
  private toolCallErrorCount = 0;
  private toolCallDuration = newAccumulator();
  private toolCallsByName = new Map<string, BreakdownEntry>();

  // MCP calls
  private mcpCallCount = 0;
  private mcpCallErrorCount = 0;
  private mcpCallDuration = newAccumulator();
  private mcpCallsByServer = new Map<string, BreakdownEntry>();

  // HTTP
  private httpRequestCount = 0;
  private httpRequestDuration = newAccumulator();
  private httpRequestsByRoute = new Map<string, BreakdownEntry>();

  recordRespondStart(): void {
    this.respondActive += 1;
  }

  recordRespondEnd(durationMs: number, error: boolean): void {
    this.respondActive = Math.max(0, this.respondActive - 1);
    this.respondCount += 1;
    if (error) this.respondErrorCount += 1;
    recordValue(this.respondDuration, durationMs);
  }

  recordTokenUsage(inputTokens: number, outputTokens: number): void {
    this.inputTokensTotal += inputTokens;
    this.outputTokensTotal += outputTokens;
  }

  recordToolCall(name: string, durationMs: number, error: boolean): void {
    this.toolCallCount += 1;
    if (error) this.toolCallErrorCount += 1;
    recordValue(this.toolCallDuration, durationMs);

    const entry = this.toolCallsByName.get(name) ?? newBreakdownEntry();
    entry.count += 1;
    if (error) entry.errors += 1;
    recordValue(entry.duration, durationMs);
    this.toolCallsByName.set(name, entry);
  }

  recordMcpCall(serverName: string, durationMs: number, error: boolean): void {
    this.mcpCallCount += 1;
    if (error) this.mcpCallErrorCount += 1;
    recordValue(this.mcpCallDuration, durationMs);

    const entry = this.mcpCallsByServer.get(serverName) ?? newBreakdownEntry();
    entry.count += 1;
    if (error) entry.errors += 1;
    recordValue(entry.duration, durationMs);
    this.mcpCallsByServer.set(serverName, entry);
  }

  recordHttpRequest(route: string, durationMs: number, error: boolean): void {
    this.httpRequestCount += 1;
    recordValue(this.httpRequestDuration, durationMs);

    const entry = this.httpRequestsByRoute.get(route) ?? newBreakdownEntry();
    entry.count += 1;
    if (error) entry.errors += 1;
    recordValue(entry.duration, durationMs);
    this.httpRequestsByRoute.set(route, entry);
  }

  snapshot(): DevMetricsSnapshot {
    return {
      respondCount: this.respondCount,
      respondErrorCount: this.respondErrorCount,
      respondDuration: snapshotHistogram(this.respondDuration),
      respondActive: this.respondActive,

      inputTokensTotal: this.inputTokensTotal,
      outputTokensTotal: this.outputTokensTotal,

      toolCallCount: this.toolCallCount,
      toolCallErrorCount: this.toolCallErrorCount,
      toolCallDuration: snapshotHistogram(this.toolCallDuration),
      toolCallsByName: snapshotBreakdown(this.toolCallsByName),

      mcpCallCount: this.mcpCallCount,
      mcpCallErrorCount: this.mcpCallErrorCount,
      mcpCallDuration: snapshotHistogram(this.mcpCallDuration),
      mcpCallsByServer: snapshotBreakdown(this.mcpCallsByServer),

      httpRequestCount: this.httpRequestCount,
      httpRequestDuration: snapshotHistogram(this.httpRequestDuration),
      httpRequestsByRoute: snapshotBreakdown(this.httpRequestsByRoute),

      collectorStartedAt: this.startedAt,
      snapshotAt: new Date().toISOString(),
    };
  }

  reset(): void {
    this.startedAt = new Date().toISOString();
    this.respondCount = 0;
    this.respondErrorCount = 0;
    this.respondDuration = newAccumulator();
    this.respondActive = 0;
    this.inputTokensTotal = 0;
    this.outputTokensTotal = 0;
    this.toolCallCount = 0;
    this.toolCallErrorCount = 0;
    this.toolCallDuration = newAccumulator();
    this.toolCallsByName = new Map();
    this.mcpCallCount = 0;
    this.mcpCallErrorCount = 0;
    this.mcpCallDuration = newAccumulator();
    this.mcpCallsByServer = new Map();
    this.httpRequestCount = 0;
    this.httpRequestDuration = newAccumulator();
    this.httpRequestsByRoute = new Map();
  }
}

/* ------------------------------------------------------------------ */
/*  Hono middleware adapter                                            */
/* ------------------------------------------------------------------ */

export function devMetricsMiddleware(collector: DevMetricsCollector) {
  return async function metricsMiddleware(c: Context, next: Next): Promise<void> {
    const startMs = performance.now();
    await next();
    const durationMs = performance.now() - startMs;
    const route = c.req.routePath ?? c.req.path;
    const isError = c.res.status >= 400;
    collector.recordHttpRequest(`${c.req.method} ${route}`, durationMs, isError);
  };
}
