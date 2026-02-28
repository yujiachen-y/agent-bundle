import { createWebUIServer } from "../../webui/create-webui-server.js";
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

type CreateWebUIServerResult = ReturnType<typeof createWebUIServer>;

export type DevDependencies = SharedServeDependencies & {
  createWebUIServerImpl?: typeof createWebUIServer;
};

type ShutdownResources = {
  agent: Agent;
  webUI: CreateWebUIServerResult | null;
  httpServer: StartedHttpServer | null;
};

async function shutdownDevResources(resources: ShutdownResources): Promise<void> {
  const errors: unknown[] = [];

  try {
    await resources.httpServer?.close();
  } catch (error) {
    errors.push(error);
  }

  try {
    resources.webUI?.shutdown();
  } catch (error) {
    errors.push(error);
  }

  try {
    await resources.agent.shutdown();
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw errors[0];
  }
}

export async function runDevCommand(
  options: RunServeOptions,
  dependencies: DevDependencies = {},
): Promise<RunServeResult> {
  const createWebUIServerImpl = dependencies.createWebUIServerImpl ?? createWebUIServer;
  const startHttpServerImpl = dependencies.startHttpServerImpl ?? startHttpServer;
  const signalProcess = dependencies.signalProcess ?? process;
  const exit = dependencies.exit ?? ((code: number) => process.exit(code));

  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const port = options.port ?? await resolveServicePort(0);
  validatePort(port);

  const context = await initializeServeContext(options, dependencies);
  stdout.write(`Starting bundle "${context.config.name}" from ${context.configPath}\n`);

  let webUI: CreateWebUIServerResult | null = null;
  let httpServer: StartedHttpServer | null = null;
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async (): Promise<void> => {
    if (!shutdownPromise) {
      shutdownPromise = shutdownDevResources({ agent: context.agent, webUI, httpServer });
    }
    return await shutdownPromise;
  };

  try {
    webUI = createWebUIServerImpl({
      agent: context.agent,
      sandbox: context.webUISandbox,
      commands: context.commands,
      skills: context.skills,
    });
    httpServer = await startHttpServerImpl({
      appFetch: webUI.app.fetch.bind(webUI.app),
      handleUpgrade: webUI.handleUpgrade,
      port,
      stderr,
    });
    stdout.write(`Dev server ready at http://localhost:${httpServer.port}\n`);
    await wireSignalShutdown(signalProcess, shutdown, exit, stderr);
  } finally {
    await shutdown();
  }

  if (!httpServer) {
    throw new Error("Dev HTTP server did not start.");
  }

  return { port: httpServer.port };
}
