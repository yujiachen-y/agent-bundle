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
  createWebUIServerMock: ReturnType<typeof vi.fn>;
  startHttpServerMock: ReturnType<typeof vi.fn>;
  serveTUIMock: ReturnType<typeof vi.fn>;
  closeServerMock: ReturnType<typeof vi.fn>;
  webUIShutdownMock: ReturnType<typeof vi.fn>;
  agentShutdownMock: ReturnType<typeof vi.fn>;
};

export const DEFAULT_CONFIG_PATH = "/tmp/agent-bundle-workspace/agent-bundle.yaml";

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

  const webUIShutdownMock = vi.fn();
  const createWebUIServerMock = vi.fn((input: unknown) => {
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

  const closeServerMock = vi.fn(async () => undefined);
  const startHttpServerMock = vi.fn(
    async (input: StartHttpServerInput): Promise<StartedHttpServer> => {
      void input;
      return {
        port: 4310,
        close: closeServerMock,
      };
    },
  );

  const serveTUIMock = vi.fn(async () => undefined);

  return {
    agent,
    env,
    captured,
    loadConfigMock,
    loadSkillsMock,
    generateSystemPromptMock,
    defineAgentMock,
    createWebUIServerMock,
    startHttpServerMock,
    serveTUIMock,
    closeServerMock,
    webUIShutdownMock,
    agentShutdownMock,
  };
}
