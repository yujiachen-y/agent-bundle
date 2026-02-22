import { serve } from "@hono/node-server";

import { CodeFormatterE2b as factory } from "../../dist/code-formatter-e2b/index.ts";
import { createServer } from "../../src/service/create-server.js";

const PORT = Number(process.env.PORT ?? 3001);
const instance = await factory.init({ variables: {} as Record<never, string> });
const app = createServer(instance);
let shuttingDown = false;

async function shutdownAndExit(code: number, reason: string, error?: unknown): Promise<never> {
  if (shuttingDown) {
    process.exit(code);
  }

  shuttingDown = true;

  if (error !== undefined) {
    console.error(`[demo/e2b-server] ${reason}`);
    console.error(error);
  }

  try {
    await instance.shutdown();
  } catch (shutdownError) {
    console.error("[demo/e2b-server] Failed to shutdown agent instance cleanly.");
    console.error(shutdownError);
  }

  process.exit(code);
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
