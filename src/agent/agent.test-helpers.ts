import type {
  AgentLoop,
  AgentLoopConfig,
  ResponseEvent,
  ResponseInput,
  RunOptions,
} from "../agent-loop/index.js";
import type {
  ExecOptions,
  ExecResult,
  FileEntry,
  Sandbox,
  SandboxIO,
  SandboxConfig,
  SandboxHooks,
  SpawnOptions,
  SpawnedProcess,
  SandboxStatus,
} from "../sandbox/index.js";
import { AgentImpl } from "./agent.js";
import type { AgentDependencies, McpClientManager } from "./dependencies.js";
import type { AgentConfig, InitOptions, McpServerConfig } from "./types.js";

export class FakeLoop implements AgentLoop {
  public readonly initConfigs: AgentLoopConfig[] = [];
  public readonly runInputs: ResponseInput[] = [];

  public disposeCount = 0;

  private initError: Error | null = null;
  private readonly queuedRuns: ResponseEvent[][] = [];

  public setInitError(error: Error): void {
    this.initError = error;
  }

  public enqueueRun(events: ResponseEvent[]): void {
    this.queuedRuns.push(events);
  }

  public async init(config: AgentLoopConfig): Promise<void> {
    if (this.initError) {
      throw this.initError;
    }

    this.initConfigs.push(config);
  }

  public async *run(input: ResponseInput, options?: RunOptions): AsyncIterable<ResponseEvent> {
    void options;
    this.runInputs.push(input);
    const events = this.queuedRuns.shift() ?? [];

    for (const event of events) {
      yield event;
    }
  }

  public async dispose(): Promise<void> {
    this.disposeCount += 1;
  }
}

export class FakeSandbox implements Sandbox {
  public readonly id = "sandbox-1";

  public status: SandboxStatus = "idle";

  public readonly execCalls: Array<{ command: string; options?: ExecOptions }> = [];
  public readonly spawnCalls: Array<{
    command: string;
    args: string[];
    options?: SpawnOptions;
  }> = [];
  public readonly readCalls: string[] = [];
  public readonly writeCalls: Array<{ path: string; content: string | Buffer }> = [];

  public startCount = 0;
  public shutdownCount = 0;

  public nextReadResult = "sandbox-file-content";
  public nextExecResult: ExecResult = {
    stdout: "",
    stderr: "",
    exitCode: 0,
  };
  public nextSpawnedProcess: SpawnedProcess = createSpawnedProcessStub();

  public async start(): Promise<void> {
    this.startCount += 1;
    this.status = "ready";
  }

  public async shutdown(): Promise<void> {
    this.shutdownCount += 1;
    this.status = "stopped";
  }

  public async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.execCalls.push({ command, options });
    return this.nextExecResult;
  }

  public async spawn(
    command: string,
    args: string[] = [],
    options?: SpawnOptions,
  ): Promise<SpawnedProcess> {
    this.spawnCalls.push({ command, args, options });
    return this.nextSpawnedProcess;
  }

  public readonly file = {
    read: async (path: string): Promise<string> => {
      this.readCalls.push(path);
      return this.nextReadResult;
    },
    write: async (path: string, content: string | Buffer): Promise<void> => {
      this.writeCalls.push({ path, content });
    },
    list: async (path: string): Promise<FileEntry[]> => {
      void path;
      return [];
    },
    delete: async (path: string): Promise<void> => {
      void path;
      return undefined;
    },
  };
}

export type Harness = {
  agent: AgentImpl<"user_name">;
  loop: FakeLoop;
  sandbox: FakeSandbox;
  dependencies: AgentDependencies;
};

function createBaseSandboxConfig(): SandboxConfig {
  return {
    provider: "e2b",
    timeout: 900,
    resources: {
      cpu: 2,
      memory: "512MB",
    },
  };
}

function createBaseAgentConfig(overrides: Partial<AgentConfig<"user_name">> = {}): AgentConfig<"user_name"> {
  return {
    name: "invoice-processor",
    sandbox: createBaseSandboxConfig(),
    model: {
      provider: "ollama",
      model: "qwen2.5-coder",
    },
    systemPrompt: "Current user: {{user_name}}",
    variables: ["user_name"] as const,
    ...overrides,
  };
}

function createBaseInitOptions(overrides: Partial<InitOptions<"user_name">> = {}): InitOptions<"user_name"> {
  return {
    variables: {
      user_name: "Alice",
    },
    ...overrides,
  };
}

export function createHarness(options: {
  configOverrides?: Partial<AgentConfig<"user_name">>;
  initOverrides?: Partial<InitOptions<"user_name">>;
  mcpClientManager?: McpClientManager | null;
  order?: string[];
} = {}): Harness {
  const loop = new FakeLoop();
  const sandbox = new FakeSandbox();

  const dependencies: AgentDependencies = {
    createSandbox: (config: SandboxConfig, hooks?: SandboxHooks) => {
      void config;
      void hooks;
      options.order?.push("createSandbox");
      return sandbox;
    },
    createLoop: () => {
      options.order?.push("createLoop");
      return loop;
    },
    createMcpClientManager: async (
      servers: readonly McpServerConfig[],
      tokens: Record<string, string>,
      mcpSandbox?: SandboxIO | null,
    ) => {
      void servers;
      void tokens;
      void mcpSandbox;
      options.order?.push("createMcpClientManager");
      return options.mcpClientManager ?? null;
    },
  };

  const agent = new AgentImpl(
    createBaseAgentConfig(options.configOverrides),
    createBaseInitOptions(options.initOverrides),
    dependencies,
  );

  return {
    agent,
    loop,
    sandbox,
    dependencies,
  };
}

export async function collectEvents(iterable: AsyncIterable<ResponseEvent>): Promise<ResponseEvent[]> {
  const events: ResponseEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }

  return events;
}

function createSpawnedProcessStub(): SpawnedProcess {
  return {
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
  };
}
