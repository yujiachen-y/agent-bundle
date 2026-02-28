import { createServer } from "../../service/create-server.js";
import type { Agent } from "../../agent/types.js";
import { startHttpServer, type StartedHttpServer } from "./http.js";
import {
  initializeServeContext,
  validatePort,
  wireSignalShutdown,
  type RunServeOptions,
  type RunServeResult,
  type ServeDependencies as SharedServeDependencies,
} from "./init.js";
import { resolveServicePort } from "./worktree-port.js";

export { DEFAULT_SERVE_PORT } from "./init.js";

export type ServeDependencies = SharedServeDependencies & {
  createServerImpl?: typeof createServer;
};

type ShutdownResources = {
  agent: Agent;
  httpServer: StartedHttpServer | null;
};

async function shutdownServeResources(resources: ShutdownResources): Promise<void> {
  const errors: unknown[] = [];

  try {
    await resources.httpServer?.close();
  } catch (error) {
    errors.push(error);
  }

  try {
    await resources.agent.shutdown();
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, "Shutdown failed");
  } else if (errors.length === 1) {
    throw errors[0];
  }
}

export async function runServeCommand(
  options: RunServeOptions,
  dependencies: ServeDependencies = {},
): Promise<RunServeResult> {
  const createServerImpl = dependencies.createServerImpl ?? createServer;
  const startHttpServerImpl = dependencies.startHttpServerImpl ?? startHttpServer;
  const signalProcess = dependencies.signalProcess ?? process;
  const exit = dependencies.exit ?? ((code: number) => process.exit(code));

  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const port = options.port ?? await resolveServicePort(0);
  validatePort(port);

  const context = await initializeServeContext(options, dependencies);
  stdout.write(`Starting bundle "${context.config.name}" from ${context.configPath}\n`);

  let httpServer: StartedHttpServer | null = null;
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async (): Promise<void> => {
    if (!shutdownPromise) {
      shutdownPromise = shutdownServeResources({ agent: context.agent, httpServer });
    }
    return await shutdownPromise;
  };

  try {
    const app = createServerImpl(context.agent, {
      commands: context.commands,
    });
    httpServer = await startHttpServerImpl({
      appFetch: app.fetch.bind(app),
      port,
      stderr,
    });
    stdout.write(`Serve ready at http://localhost:${httpServer.port}\n`);
    await wireSignalShutdown(signalProcess, shutdown, exit, stderr);
  } finally {
    await shutdown();
  }

  if (!httpServer) {
    throw new Error("Serve HTTP server did not start.");
  }

  return { port: httpServer.port };
}
