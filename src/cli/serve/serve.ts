import { defineAgent } from "../../agent/define-agent.js";
import type { Agent, AgentConfig, AgentFactory, InitOptions } from "../../agent/types.js";
import type { Command } from "../../commands/types.js";
import type { BundleConfig } from "../../schema/bundle.js";
import type { Sandbox, SandboxIO } from "../../sandbox/types.js";
import { createWebUIServer } from "../../webui/create-webui-server.js";
import { toErrorMessage } from "../error.js";
import {
  parseKeyValueEntries,
  resolveInitVariables,
  resolveMcpTokens,
  resolveServeInputs,
  resolveServeSandboxConfig,
  type KeyValueArgInput,
} from "./runtime.js";
import { startHttpServer, type StartedHttpServer, type StartHttpServerInput } from "./http.js";
import { resolveServicePort } from "./worktree-port.js";

export const DEFAULT_SERVE_PORT = 3000;

type DefineAgentForServe = (config: AgentConfig<string>) => AgentFactory<string>;

type CreateWebUIServerResult = ReturnType<typeof createWebUIServer>;

type ServeDependencies = {
  defineAgentImpl?: DefineAgentForServe;
  createWebUIServerImpl?: typeof createWebUIServer;
  startHttpServerImpl?: (input: StartHttpServerInput) => Promise<StartedHttpServer>;
  signalProcess?: Pick<NodeJS.Process, "on" | "off">;
  env?: NodeJS.ProcessEnv;
  exit?: (code: number) => void;
  loadConfig?: Parameters<typeof resolveServeInputs>[1];
  loadSkills?: Parameters<typeof resolveServeInputs>[2];
  generateSystemPrompt?: Parameters<typeof resolveServeInputs>[3];
};

type ShutdownResources = {
  agent: Agent;
  webUI: CreateWebUIServerResult | null;
  httpServer: StartedHttpServer | null;
};

type InitializedServeContext = {
  configPath: string;
  config: BundleConfig;
  agent: Agent;
  webUISandbox: Sandbox;
  commands: Command[];
};

export type RunServeOptions = {
  configPath: string;
  port?: number;
  variableEntries?: KeyValueArgInput;
  mcpTokenEntries?: KeyValueArgInput;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
};

export type RunServeResult = {
  port: number;
};

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Serve port must be an integer between 1 and 65535.");
  }
}

function toWebUISandboxAdapter(sandboxIO: SandboxIO): Sandbox {
  let status: Sandbox["status"] = "ready";

  return {
    id: "serve-sandbox",
    get status() {
      return status;
    },
    // Adapter does not own lifecycle; the real sandbox is managed by AgentImpl.
    start: async () => {
      status = "ready";
    },
    // Reflect shutdown state for any status-based observer in WebUI integrations.
    shutdown: async () => {
      status = "stopped";
    },
    exec: async (command, options) => {
      return await sandboxIO.exec(command, options);
    },
    spawn: async (command, args, options) => {
      return await sandboxIO.spawn(command, args, options);
    },
    file: sandboxIO.file,
  };
}

async function shutdownServeResources(resources: ShutdownResources): Promise<void> {
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

async function initializeServeContext(
  options: RunServeOptions,
  dependencies: ServeDependencies,
): Promise<InitializedServeContext> {
  const defineAgentImpl = dependencies.defineAgentImpl ?? (defineAgent as DefineAgentForServe);
  const env = dependencies.env ?? process.env;
  const variableOverrides = parseKeyValueEntries(options.variableEntries, "--var");
  const mcpTokenOverrides = parseKeyValueEntries(options.mcpTokenEntries, "--mcp-token");

  const { configPath, config, systemPrompt, commands } = await resolveServeInputs(
    options.configPath,
    dependencies.loadConfig,
    dependencies.loadSkills,
    dependencies.generateSystemPrompt,
  );

  const variables = resolveInitVariables(config.prompt.variables, variableOverrides, env);
  const mcpServers = config.mcp?.servers ?? [];
  const mcpTokens = resolveMcpTokens(mcpServers, mcpTokenOverrides, env);

  const agentFactoryConfig: AgentConfig<string> = {
    name: config.name,
    sandbox: resolveServeSandboxConfig(config.sandbox),
    model: config.model,
    systemPrompt,
    variables: config.prompt.variables,
    ...(mcpServers.length > 0 ? { mcp: mcpServers } : {}),
  };

  let capturedSandboxIO: SandboxIO | null = null;
  const initOptions: InitOptions<string> = {
    variables,
    hooks: {
      postMount: async (io) => {
        capturedSandboxIO = io;
      },
    },
    ...(Object.keys(mcpTokens).length > 0 ? { mcpTokens } : {}),
  };

  const agent = await defineAgentImpl(agentFactoryConfig).init(initOptions);
  if (!capturedSandboxIO) {
    await agent.shutdown();
    throw new Error("Agent initialized without exposing sandbox IO for WebUI.");
  }

  return {
    configPath,
    config,
    agent,
    webUISandbox: toWebUISandboxAdapter(capturedSandboxIO),
    commands,
  };
}

export async function runServeCommand(
  options: RunServeOptions,
  dependencies: ServeDependencies = {},
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
      shutdownPromise = shutdownServeResources({ agent: context.agent, webUI, httpServer });
    }
    return await shutdownPromise;
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    void shutdown()
      .then(() => exit(0))
      .catch((error) => {
        stderr.write(`[serve] failed to shutdown on ${signal}: ${toErrorMessage(error)}\n`);
        exit(1);
      });
  };

  signalProcess.on("SIGINT", onSignal);
  signalProcess.on("SIGTERM", onSignal);

  try {
    webUI = createWebUIServerImpl({
      agent: context.agent,
      sandbox: context.webUISandbox,
      commands: context.commands,
    });
    httpServer = await startHttpServerImpl({
      appFetch: webUI.app.fetch.bind(webUI.app),
      handleUpgrade: webUI.handleUpgrade,
      port,
      stderr,
    });
    stdout.write(`Serve ready at http://localhost:${httpServer.port}\n`);
    await new Promise<void>((resolve) => {
      const onShutdownSignal = () => {
        signalProcess.off("SIGINT", onShutdownSignal);
        signalProcess.off("SIGTERM", onShutdownSignal);
        resolve();
      };
      signalProcess.on("SIGINT", onShutdownSignal);
      signalProcess.on("SIGTERM", onShutdownSignal);
    });
  } finally {
    signalProcess.off("SIGINT", onSignal);
    signalProcess.off("SIGTERM", onSignal);
    await shutdown();
  }

  if (!httpServer) {
    throw new Error("Serve HTTP server did not start.");
  }

  return { port: httpServer.port };
}
