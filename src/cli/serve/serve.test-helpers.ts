import type { Agent, AgentConfig, AgentFactory, InitOptions } from "../../agent/types.js";
import type { BundleConfig } from "../../schema/bundle.js";
import type { SandboxIO } from "../../sandbox/types.js";
import type { Skill } from "../../skills/loader.js";
import type { StartedHttpServer, StartHttpServerInput } from "./http.js";

import { vi } from "vitest";

type ServeHarnessOptions = {
  config?: BundleConfig;
  env?: NodeJS.ProcessEnv;
  callPostMountHook?: boolean;
};

type SignalListener = (...args: unknown[]) => void;

export type ServeHarness = {
  agent: Agent;
  env: NodeJS.ProcessEnv;
  captured: {
    agentConfig: AgentConfig<string> | null;
    initOptions: InitOptions<string> | null;
  };
  loadConfigMock: ReturnType<typeof vi.fn>;
  loadSkillsMock: ReturnType<typeof vi.fn>;
  generateSystemPromptMock: ReturnType<typeof vi.fn>;
  defineAgentMock: ReturnType<typeof vi.fn>;
  createServerMock: ReturnType<typeof vi.fn>;
  createWebUIServerMock: ReturnType<typeof vi.fn>;
  startHttpServerMock: ReturnType<typeof vi.fn>;
  closeServerMock: ReturnType<typeof vi.fn>;
  webUIShutdownMock: ReturnType<typeof vi.fn>;
  agentShutdownMock: ReturnType<typeof vi.fn>;
};

export const DEFAULT_CONFIG_PATH = "/tmp/agent-bundle-workspace/agent-bundle.yaml";

export function createSignalMock() {
  const listeners = new Map<string, Set<SignalListener>>();
  const signalProcess = {
    on: (signal: string, listener: SignalListener) => {
      if (!listeners.has(signal)) listeners.set(signal, new Set());
      listeners.get(signal)!.add(listener);
      return signalProcess;
    },
    off: (signal: string, listener: SignalListener) => {
      const set = listeners.get(signal);
      if (set) {
        set.delete(listener);
        if (set.size === 0) listeners.delete(signal);
      }
      return signalProcess;
    },
  } as unknown as Pick<NodeJS.Process, "on" | "off">;

  const fire = (signal: string) => {
    for (const listener of [...(listeners.get(signal) ?? [])]) {
      listener(signal);
    }
  };

  return { signalProcess, fire, listeners };
}

export function createBaseConfig(): BundleConfig {
  return {
    name: "invoice-processor",
    model: {
      provider: "openai",
      model: "gpt-5-mini",
    },
    prompt: {
      system: "You are concise.",
      variables: [],
    },
    sandbox: {
      provider: "kubernetes",
      timeout: 900,
      resources: {
        cpu: 2,
        memory: "512MB",
      },
      kubernetes: {
        image: "agent-bundle/execd:latest",
      },
    },
    skills: [
      {
        path: "./skills/format-code",
      },
    ],
  };
}

function createSandboxIO(): SandboxIO {
  return {
    exec: async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    }),
    spawn: async () => ({
      pid: 1,
      stdin: new WritableStream<Uint8Array>({
        write: async () => undefined,
      }),
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      stderr: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
      exited: Promise.resolve(0),
      kill: async () => undefined,
    }),
    file: {
      read: async () => "",
      write: async () => undefined,
      list: async () => [],
      delete: async () => undefined,
    },
  };
}

function createSkills(): Skill[] {
  return [
    {
      name: "FormatCode",
      description: "Format source files inside sandbox",
      content: "---\nname: FormatCode\ndescription: Format source files inside sandbox\n---\n",
      sourcePath: "/tmp/agent-bundle-workspace/skills/format-code/SKILL.md",
    },
  ];
}

function createApiServerMock(): ReturnType<typeof vi.fn> {
  return vi.fn(() => {
    return {
      fetch: async (request: Request) => {
        void request;
        return new Response("ok");
      },
    };
  });
}

function createWebUIServerMockFactory(
  webUIShutdownMock: ReturnType<typeof vi.fn>,
): ReturnType<typeof vi.fn> {
  return vi.fn((input: unknown) => {
    void input;
    return {
      app: {
        fetch: async (request: Request) => {
          void request;
          return new Response("ok");
        },
      },
      eventBus: {
        subscribe: () => () => undefined,
        emit: () => undefined,
        listenerCount: () => 0,
        dispose: () => undefined,
      },
      handleUpgrade: () => undefined,
      shutdown: webUIShutdownMock,
    };
  });
}

function createHttpServerStarterMock(
  closeServerMock: ReturnType<typeof vi.fn>,
): ReturnType<typeof vi.fn> {
  return vi.fn(
    async (input: StartHttpServerInput): Promise<StartedHttpServer> => {
      void input;
      return {
        port: 4310,
        close: closeServerMock,
      };
    },
  );
}

export function createServeHarness(options: ServeHarnessOptions = {}): ServeHarness {
  const config = options.config ?? createBaseConfig();
  const env = options.env ?? {};
  const callPostMountHook = options.callPostMountHook ?? true;
  const sandboxIO = createSandboxIO();

  const agentShutdownMock = vi.fn(async () => undefined);
  const agent: Agent = {
    name: config.name,
    status: "ready",
    respond: async () => ({
      id: "resp-1",
      output: "ok",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    }),
    respondStream: async function* () {
      return;
    },
    shutdown: agentShutdownMock,
  };

  const captured: ServeHarness["captured"] = {
    agentConfig: null,
    initOptions: null,
  };

  const loadConfigMock = vi.fn(async () => config);
  const loadSkillsMock = vi.fn(async () => createSkills());
  const generateSystemPromptMock = vi.fn(() => "generated-system-prompt");
  const defineAgentMock = vi.fn((agentConfig: AgentConfig<string>): AgentFactory<string> => {
    captured.agentConfig = agentConfig;
    return {
      name: config.name,
      init: async (initOptions: InitOptions<string>) => {
        captured.initOptions = initOptions;
        if (callPostMountHook) {
          await initOptions.hooks?.postMount?.(sandboxIO);
        }
        return agent;
      },
    };
  });

  const createServerMock = createApiServerMock();
  const webUIShutdownMock = vi.fn();
  const createWebUIServerMock = createWebUIServerMockFactory(webUIShutdownMock);

  const closeServerMock = vi.fn(async () => undefined);
  const startHttpServerMock = createHttpServerStarterMock(closeServerMock);

  return {
    agent,
    env,
    captured,
    loadConfigMock,
    loadSkillsMock,
    generateSystemPromptMock,
    defineAgentMock,
    createServerMock,
    createWebUIServerMock,
    startHttpServerMock,
    closeServerMock,
    webUIShutdownMock,
    agentShutdownMock,
  };
}
