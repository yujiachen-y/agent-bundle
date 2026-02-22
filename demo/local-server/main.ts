import { serve } from "@hono/node-server";

import { CodeFormatter as factory } from "../../dist/code-formatter/index.ts";
import { createServer } from "../../src/service/create-server.js";

const instance = await factory.init({ variables: {} as Record<never, string> });

const app = createServer(instance);
const PORT = Number(process.env.PORT ?? 3000);
let isShuttingDown = false;

async function shutdownAndExit(exitCode: number, context: string, error?: unknown): Promise<never> {
  if (isShuttingDown) {
    process.exit(exitCode);
  }

  isShuttingDown = true;
  if (error !== undefined) {
    console.error(`[demo/local-server] ${context}`);
    console.error(error);
  }

  try {
    await instance.shutdown();
  } catch (shutdownError) {
    console.error("[demo/local-server] Failed to shutdown agent instance cleanly.");
    console.error(shutdownError);
  }

  process.exit(exitCode);
}

serve({ fetch: app.fetch, port: PORT });
console.log(`Listening on http://localhost:${PORT}`);

process.on("SIGINT", () => {
  void shutdownAndExit(0, "Received SIGINT.");
});

process.on("SIGTERM", () => {
  void shutdownAndExit(0, "Received SIGTERM.");
});

process.on("uncaughtException", (error) => {
  void shutdownAndExit(1, "Uncaught exception.", error);
});

process.on("unhandledRejection", (error) => {
  void shutdownAndExit(1, "Unhandled promise rejection.", error);
});
