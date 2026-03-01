import {
  fillSystemPrompt,
  type AgentLoop,
  type ResponseInput,
  type ResponseOutput,
  type ToolCall,
  type ToolResult,
} from "../agent-loop/index.js";
import {
  createAgentHooks,
  createMcpCallInstrumenter,
  createToolCallInstrumenter,
  type AgentObservabilityHooks,
} from "../observability/hooks.js";
import type { Sandbox } from "../sandbox/index.js";
import {
  createDefaultDependencies,
  type AgentDependencies,
  type McpClientManager,
} from "./dependencies.js";
import {
  disposeResources,
  extractOptionalChunkHandler,
  ensureRunnableStatus,
  extractOptionalNumber,
  extractOptionalString,
  extractRequiredNonEmptyString,
  extractRequiredString,
  formatExecResult,
  isMcpTool,
  parseMcpToolName,
  readFieldError,
  readFieldTypeError,
  toConversationInput,
  toErrorMessage,
  toNextConversationHistory,
  toToolError,
  validateModelApiKey,
} from "./internals.js";
import type { Agent, AgentConfig, AgentStatus, InitOptions, RespondStreamOptions } from "./types.js";

export class AgentImpl<V extends string> implements Agent {
  public readonly name: string;

  private statusValue: AgentStatus = "stopped";
  private sandbox: Sandbox | null = null;
  private loop: AgentLoop | null = null;
  private mcpClientManager: McpClientManager | null = null;
  private conversationHistory: ResponseInput = [];
  private readonly otelHooks: AgentObservabilityHooks | null;
  private readonly instrumentToolCall: ReturnType<typeof createToolCallInstrumenter> | null;
  private readonly instrumentMcpCall: ReturnType<typeof createMcpCallInstrumenter> | null;

  public constructor(
    private readonly config: AgentConfig<V>,
    private readonly options: InitOptions<V>,
    private readonly dependencies: AgentDependencies = createDefaultDependencies(),
  ) {
    this.name = config.name;
    const otel = dependencies.observability ?? null;
    this.otelHooks = otel ? createAgentHooks(otel, config.name) : null;
    this.instrumentToolCall = otel ? createToolCallInstrumenter(otel) : null;
    this.instrumentMcpCall = otel ? createMcpCallInstrumenter(otel) : null;
  }

  public get status(): AgentStatus {
    return this.statusValue;
  }

  public async initialize(): Promise<void> {
    const systemPrompt = fillSystemPrompt(this.config.systemPrompt, this.options.variables);
    validateModelApiKey(this.config.model.provider);
    const sandbox = this.dependencies.createSandbox(this.config.sandbox, this.options.hooks ?? {});
    const loop = this.dependencies.createLoop();

    this.sandbox = sandbox;
    this.loop = loop;
    this.conversationHistory = this.options.session?.conversationHistory ?? [];

    try {
      await sandbox.start();
      this.mcpClientManager = await this.createMcpManager();
      const externalTools = this.mcpClientManager?.tools ?? [];
      await loop.init({
        systemPrompt,
        model: this.config.model,
        toolHandler: async (call) => {
          return await this.handleToolCall(call);
        },
        ...(externalTools.length > 0 ? { externalTools } : {}),
      });
      this.statusValue = "ready";
    } catch (error) {
      this.statusValue = "stopped";
      await disposeResources(loop, this.mcpClientManager, sandbox);
      throw error;
    }
  }

  public async respond(input: ResponseInput): Promise<ResponseOutput> {
    let responseOutput: ResponseOutput | null = null;
    let responseError: string | null = null;

    for await (const event of this.respondStream(input)) {
      if (event.type === "response.completed") {
        responseOutput = event.output;
      }

      if (event.type === "response.error") {
        responseError = event.error;
      }
    }

    if (responseError) {
      throw new Error(responseError);
    }

    if (!responseOutput) {
      throw new Error("Agent did not produce a completed response.");
    }

    return responseOutput;
  }

  public clearHistory(): void {
    this.conversationHistory = [];
  }

  public async *respondStream(input: ResponseInput, options?: RespondStreamOptions) {
    ensureRunnableStatus(this.statusValue);

    const loop = this.loop;
    if (!loop) {
      throw new Error("Agent loop is not initialized.");
    }

    const signal = options?.signal;
    const runInput = toConversationInput(this.conversationHistory, input);
    this.statusValue = "running";
    const startMs = this.otelHooks?.onRespondStart();

    let completedOutput: ResponseOutput | null = null;
    let respondError: unknown;

    try {
      for await (const event of loop.run(runInput, { signal })) {
        if (signal?.aborted) break;

        if (event.type === "response.completed") {
          completedOutput = event.output;
          if (event.output.usage && this.otelHooks) {
            this.otelHooks.onTokenUsage(event.output.usage);
          }
        }

        if (event.type === "response.error") {
          respondError = new Error(event.error);
        }

        yield event;
      }
    } catch (error) {
      respondError = error;
      throw error;
    } finally {
      if (!this.isStopped()) {
        this.statusValue = "ready";
      }
      if (startMs !== undefined && this.otelHooks) {
        this.otelHooks.onRespondEnd(startMs, respondError);
      }
    }

    if (!respondError && completedOutput) {
      this.conversationHistory = toNextConversationHistory(runInput, completedOutput);
    }
  }

  public async shutdown(): Promise<void> {
    if (this.statusValue === "stopped") {
      return;
    }

    const loop = this.loop;
    const mcpClientManager = this.mcpClientManager;
    const sandbox = this.sandbox;

    this.statusValue = "stopped";
    this.loop = null;
    this.mcpClientManager = null;
    this.sandbox = null;

    await disposeResources(loop, mcpClientManager, sandbox);
  }

  private async createMcpManager(): Promise<McpClientManager | null> {
    if (!this.config.mcp || this.config.mcp.length === 0) {
      return null;
    }

    const mcpTokens = this.options.mcpTokens ?? {};
    return await this.dependencies.createMcpClientManager(
      this.config.mcp,
      mcpTokens,
      this.sandbox,
    );
  }

  private async handleToolCall(call: ToolCall): Promise<ToolResult> {
    if (this.instrumentToolCall) {
      return this.instrumentToolCall(call, (c) => this.executeToolCall(c));
    }

    return this.executeToolCall(call);
  }

  private async executeToolCall(call: ToolCall): Promise<ToolResult> {
    const sandbox = this.sandbox;
    if (!sandbox) {
      return toToolError(call.id, "Sandbox is not available.");
    }

    try {
      const normalizedName = call.name.trim().toLowerCase();

      if (normalizedName === "read") {
        return await this.handleReadTool(call, sandbox);
      }

      if (normalizedName === "write") {
        return await this.handleWriteTool(call, sandbox);
      }

      if (normalizedName === "bash") {
        return await this.handleBashTool(call, sandbox);
      }

      if (isMcpTool(call.name)) {
        return await this.handleMcpTool(call);
      }

      return toToolError(call.id, `Unsupported tool \"${call.name}\".`);
    } catch (error) {
      return toToolError(call.id, toErrorMessage(error));
    }
  }

  private async handleReadTool(call: ToolCall, sandbox: Sandbox): Promise<ToolResult> {
    const path = extractRequiredNonEmptyString(call.input, "path");
    if (!path) {
      return readFieldError(call.id, "Read", "path");
    }

    const content = await sandbox.file.read(path);
    return {
      toolCallId: call.id,
      output: content,
    };
  }

  private async handleWriteTool(call: ToolCall, sandbox: Sandbox): Promise<ToolResult> {
    const path = extractRequiredNonEmptyString(call.input, "path");
    if (!path) {
      return readFieldError(call.id, "Write", "path");
    }

    const content = extractRequiredString(call.input, "content");
    if (content === null) {
      return readFieldTypeError(call.id, "Write", "content");
    }

    await sandbox.file.write(path, content);
    return {
      toolCallId: call.id,
      output: `Wrote ${content.length} bytes to ${path}.`,
    };
  }

  private async handleBashTool(call: ToolCall, sandbox: Sandbox): Promise<ToolResult> {
    const command = extractRequiredNonEmptyString(call.input, "command");
    if (!command) {
      return readFieldError(call.id, "Bash", "command");
    }

    const timeout = extractOptionalNumber(call.input, "timeout");
    const cwd = extractOptionalString(call.input, "cwd");
    const onChunk = extractOptionalChunkHandler(call.input, "onChunk");
    const execOptions = {
      timeout,
      cwd,
      ...(onChunk ? { onChunk } : {}),
    };
    const result = await sandbox.exec(command, execOptions);

    return {
      toolCallId: call.id,
      output: formatExecResult(result),
      isError: result.exitCode !== 0,
    };
  }

  private async handleMcpTool(call: ToolCall): Promise<ToolResult> {
    const mcpClientManager = this.mcpClientManager;
    if (!mcpClientManager) {
      return toToolError(call.id, `MCP tool \"${call.name}\" is not available.`);
    }

    if (this.instrumentMcpCall) {
      const parsed = parseMcpToolName(call.name);
      const serverName = parsed?.serverName ?? "unknown";
      const toolName = parsed?.toolName ?? call.name;
      return this.instrumentMcpCall(serverName, toolName, () => mcpClientManager.callTool(call));
    }

    return await mcpClientManager.callTool(call);
  }

  private isStopped(): boolean {
    return this.statusValue === "stopped";
  }
}

export async function createInitializedAgent<V extends string>(
  config: AgentConfig<V>,
  options: InitOptions<V>,
): Promise<Agent> {
  const agent = new AgentImpl(config, options);
  await agent.initialize();
  return agent;
}
