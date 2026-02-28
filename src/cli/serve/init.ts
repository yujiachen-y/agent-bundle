import { defineAgent } from "../../agent/define-agent.js";
import type { Agent, AgentConfig, AgentFactory, InitOptions } from "../../agent/types.js";
import type { Command } from "../../commands/types.js";
import type { BundleConfig } from "../../schema/bundle.js";
import type { Sandbox, SandboxIO } from "../../sandbox/types.js";
import { toErrorMessage } from "../error.js";
import {
  parseKeyValueEntries,
  resolveInitVariables,
  resolveMcpTokens,
  resolveServeInputs,
  resolveServeSandboxConfig,
  type KeyValueArgInput,
  type SkillInfo,
} from "./runtime.js";
import type { StartedHttpServer, StartHttpServerInput } from "./http.js";

export const DEFAULT_SERVE_PORT = 3000;

export type DefineAgentForServe = (config: AgentConfig<string>) => AgentFactory<string>;

export type ServeDependencies = {
  defineAgentImpl?: DefineAgentForServe;
  startHttpServerImpl?: (input: StartHttpServerInput) => Promise<StartedHttpServer>;
  signalProcess?: Pick<NodeJS.Process, "on" | "off">;
  env?: NodeJS.ProcessEnv;
  exit?: (code: number) => void;
  loadConfig?: Parameters<typeof resolveServeInputs>[1];
  loadSkills?: Parameters<typeof resolveServeInputs>[2];
  generateSystemPrompt?: Parameters<typeof resolveServeInputs>[3];
};

export type InitializedServeContext = {
  configPath: string;
  config: BundleConfig;
  agent: Agent;
  webUISandbox: Sandbox;
  commands: Command[];
  skills: SkillInfo[];
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

export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Serve port must be an integer between 1 and 65535.");
  }
}

export function toWebUISandboxAdapter(sandboxIO: SandboxIO): Sandbox {
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

export async function initializeServeContext(
  options: RunServeOptions,
  dependencies: ServeDependencies,
): Promise<InitializedServeContext> {
  const defineAgentImpl = dependencies.defineAgentImpl ?? (defineAgent as DefineAgentForServe);
  const env = dependencies.env ?? process.env;
  const variableOverrides = parseKeyValueEntries(options.variableEntries, "--var");
  const mcpTokenOverrides = parseKeyValueEntries(options.mcpTokenEntries, "--mcp-token");

  const { configPath, config, systemPrompt, commands, skills } = await resolveServeInputs(
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
    skills,
  };
}

export async function wireSignalShutdown(
  signalProcess: Pick<NodeJS.Process, "on" | "off">,
  shutdown: () => Promise<void>,
  exit: (code: number) => void,
  stderr: NodeJS.WritableStream,
): Promise<void> {
  const onSignal = (signal: NodeJS.Signals): void => {
    void shutdown()
      .then(() => exit(0))
      .catch((error) => {
        stderr.write(`[serve] failed to shutdown on ${signal}: ${toErrorMessage(error)}\n`);
        exit(1);
      });
  };

  let resolveShutdown: (() => void) | null = null;
  const onShutdownSignal = (): void => {
    resolveShutdown?.();
  };

  signalProcess.on("SIGINT", onSignal);
  signalProcess.on("SIGTERM", onSignal);
  signalProcess.on("SIGINT", onShutdownSignal);
  signalProcess.on("SIGTERM", onShutdownSignal);

  try {
    await new Promise<void>((resolve) => {
      resolveShutdown = () => {
        if (!resolveShutdown) {
          return;
        }

        resolveShutdown = null;
        resolve();
      };
    });
  } finally {
    signalProcess.off("SIGINT", onSignal);
    signalProcess.off("SIGTERM", onSignal);
    signalProcess.off("SIGINT", onShutdownSignal);
    signalProcess.off("SIGTERM", onShutdownSignal);
  }
}
