import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  ConsoleMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

import { ObservabilityDemo as factory } from "@agent-bundle/observability-demo";
import { createServer as createAgentServer } from "agent-bundle/service";
import { createObservabilityProvider } from "agent-bundle/observability";
import { resolveServicePort } from "agent-bundle/worktree-port";

// ── 1. Initialize OpenTelemetry SDK ──────────────────────────────
//
// This registers a global tracer + meter provider. agent-bundle's
// createObservabilityProvider() picks them up automatically.
// Swap exporters for Prometheus / OTLP in production — see docs/observability.md.

const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new ConsoleMetricExporter(),
    exportIntervalMillis: 15_000,
  }),
});
sdk.start();

// ── 2. Create the observability provider ─────────────────────────

const observability = createObservabilityProvider();

// ── 3. Initialize the agent ──────────────────────────────────────

const agent = await factory.init({
  variables: {} as Record<never, string>,
});

// ── 4. Build Hono app with observability-enabled agent server ────

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", observability: true }));

app.route("/agent", createAgentServer(agent, { observability }));

// ── 5. Start the HTTP server ─────────────────────────────────────

const port = await resolveServicePort(6);
const server = serve({ fetch: app.fetch, port });
console.log(`Observability demo ready at http://localhost:${port}`);
console.log("Traces and metrics are printed to stdout every 15 s.");

// ── Graceful shutdown ────────────────────────────────────────────

function closeServer(srv: unknown): Promise<void> {
  const closeFn = (srv as { close?: (cb: (err?: Error) => void) => void })?.close;
  if (typeof closeFn !== "function") return Promise.resolve();
  return new Promise<void>((res, rej) => {
    closeFn((err) => (err ? rej(err) : res()));
  });
}

let shuttingDown = false;
async function shutdownAndExit(code: number, reason: string, error?: unknown): Promise<never> {
  if (shuttingDown) process.exit(code);
  shuttingDown = true;

  if (error !== undefined) {
    console.error(`[demo/observability-demo] ${reason}`);
    console.error(error);
  }

  const results = await Promise.allSettled([
    closeServer(server),
    agent.shutdown(),
    sdk.shutdown(),
  ]);

  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[demo/observability-demo] Shutdown error:", r.reason);
    }
  }

  process.exit(code);
}

process.on("SIGINT", () => void shutdownAndExit(0, "Received SIGINT."));
process.on("SIGTERM", () => void shutdownAndExit(0, "Received SIGTERM."));
process.on("uncaughtException", (e) => void shutdownAndExit(1, "Uncaught exception.", e));
process.on("unhandledRejection", (e) => void shutdownAndExit(1, "Unhandled rejection.", e));
