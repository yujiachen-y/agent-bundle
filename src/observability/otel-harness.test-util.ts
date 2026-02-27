/**
 * Shared OTEL test harness: sets up in-memory exporters and SDK providers
 * for asserting on emitted spans and metrics in e2e tests.
 */
import { SpanStatusCode, type Attributes } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricData,
} from "@opentelemetry/sdk-metrics";

import type { ObservabilityProvider } from "./types.js";

export type OtelTestHarness = {
  provider: ObservabilityProvider;
  spanExporter: InMemorySpanExporter;
  metricExporter: InMemoryMetricExporter;
  metricReader: PeriodicExportingMetricReader;
  tracerProvider: BasicTracerProvider;
  meterProvider: MeterProvider;
  /** Flush metrics so they appear in the exporter, then return all collected metric data. */
  collectMetrics: () => Promise<MetricData[]>;
  /** Return all finished spans. */
  getSpans: () => ReadableSpan[];
  /** Find spans by name substring. */
  findSpans: (nameSubstr: string) => ReadableSpan[];
  /** Find metric data by descriptor name. */
  findMetric: (name: string) => MetricData | undefined;
  /** Shut down providers cleanly. */
  shutdown: () => Promise<void>;
};

export function createOtelTestHarness(): OtelTestHarness {
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });

  const metricExporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    // Very long interval; we will call forceFlush manually.
    exportIntervalMillis: 60_000,
  });
  const meterProvider = new MeterProvider({ readers: [metricReader] });

  const provider: ObservabilityProvider = {
    tracer: tracerProvider.getTracer("agent-bundle-e2e-test"),
    meter: meterProvider.getMeter("agent-bundle-e2e-test"),
  };

  async function collectMetrics(): Promise<MetricData[]> {
    await metricReader.forceFlush();
    const allResourceMetrics = metricExporter.getMetrics();
    return allResourceMetrics.flatMap((rm) =>
      rm.scopeMetrics.flatMap((sm) => sm.metrics),
    );
  }

  function getSpans(): ReadableSpan[] {
    return spanExporter.getFinishedSpans();
  }

  function findSpans(nameSubstr: string): ReadableSpan[] {
    return getSpans().filter((s) => s.name.includes(nameSubstr));
  }

  function findMetric(name: string): MetricData | undefined {
    // Collect synchronously from what is already flushed.
    const allResourceMetrics = metricExporter.getMetrics();
    const allMetrics = allResourceMetrics.flatMap((rm) =>
      rm.scopeMetrics.flatMap((sm) => sm.metrics),
    );
    return allMetrics.find((m) => m.descriptor.name === name);
  }

  async function shutdown(): Promise<void> {
    await tracerProvider.shutdown();
    await meterProvider.shutdown();
  }

  return {
    provider,
    spanExporter,
    metricExporter,
    metricReader,
    tracerProvider,
    meterProvider,
    collectMetrics,
    getSpans,
    findSpans,
    findMetric,
    shutdown,
  };
}

/** Assert that a span has a specific attribute value. */
export function expectSpanAttribute(
  span: ReadableSpan,
  key: string,
  expected: unknown,
): void {
  const actual = span.attributes[key];
  if (actual !== expected) {
    throw new Error(
      `Expected span "${span.name}" attribute "${key}" to be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

/** Assert that a span has OK status. */
export function expectSpanOk(span: ReadableSpan): void {
  if (span.status.code !== SpanStatusCode.OK) {
    throw new Error(
      `Expected span "${span.name}" to have OK status, got code=${span.status.code}`,
    );
  }
}

/** Assert that a span has ERROR status. */
export function expectSpanError(span: ReadableSpan): void {
  if (span.status.code !== SpanStatusCode.ERROR) {
    throw new Error(
      `Expected span "${span.name}" to have ERROR status, got code=${span.status.code}`,
    );
  }
}

/** Get sum of all data point values for a SUM metric. */
export function sumMetricValue(
  metric: MetricData,
  filterAttrs?: Attributes,
): number {
  let total = 0;
  for (const dp of metric.dataPoints) {
    if (filterAttrs && !matchesAttributes(dp.attributes, filterAttrs)) {
      continue;
    }
    total += dp.value as number;
  }
  return total;
}

/** Check that the metric has at least one data point matching the given attributes. */
export function hasDataPoint(
  metric: MetricData,
  attrs: Attributes,
): boolean {
  return metric.dataPoints.some((dp) =>
    matchesAttributes(dp.attributes, attrs),
  );
}

function matchesAttributes(
  actual: Attributes,
  expected: Attributes,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => actual[key] === value,
  );
}
