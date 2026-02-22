import { randomUUID } from "node:crypto";

import { Agent } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";

import type { AgentLoop, AgentLoopConfig, RunOptions, ToolHandler } from "../agent-loop.js";
import type { ResponseEvent, ResponseInput, ResponseOutput } from "../types.js";
import { toResponseEvent } from "./events.js";
import { getLatestAssistantMessage, toAgentMessages, toAssistantText } from "./input.js";
import { resolvePiModel } from "./model.js";
import { AsyncEventQueue } from "./queue.js";
import { createPiTools } from "./tools.js";
import { toErrorMessage, toTokenUsage } from "./utils.js";

// Only Ollama needs a local placeholder key when unauthenticated.
// Other providers use pi-ai's built-in environment-based key resolution.
function resolveOllamaApiKey(provider: string): string | undefined {
  if (provider !== "ollama") {
    return undefined;
  }

  const configuredKey = process.env.OLLAMA_API_KEY?.trim();
  if (configuredKey && configuredKey.length > 0) {
    return configuredKey;
  }

  return "ollama";
}

export class PiMonoAgentLoop implements AgentLoop {
  private agent: Agent | null = null;
  private toolHandler: ToolHandler | null = null;
  private model: Model<Api> | null = null;

  public async init(config: AgentLoopConfig): Promise<void> {
    this.model = resolvePiModel(config.model);
    this.toolHandler = config.toolHandler;
    this.agent = new Agent({
      initialState: {
        systemPrompt: config.systemPrompt,
        model: this.model,
      },
      getApiKey: resolveOllamaApiKey,
    });

    this.agent.setSystemPrompt(config.systemPrompt);
    this.agent.setTools(createPiTools(config.toolHandler));
  }

  public async *run(input: ResponseInput, options?: RunOptions): AsyncIterable<ResponseEvent> {
    if (!this.agent || !this.toolHandler || !this.model) {
      throw new Error("PiMonoAgentLoop is not initialized.");
    }

    const agent = this.agent;
    const signal = options?.signal;
    const responseId = `resp-${randomUUID()}`;
    const queue = new AsyncEventQueue<ResponseEvent>();

    const onAbort = signal
      ? (): void => {
          agent.abort();
        }
      : undefined;

    if (onAbort) {
      if (signal!.aborted) {
        agent.abort();
      } else {
        signal!.addEventListener("abort", onAbort, { once: true });
      }
    }

    const unsubscribe = agent.subscribe((event) => {
      const responseEvent = toResponseEvent(event);
      if (responseEvent) {
        queue.push(responseEvent);
      }
    });

    queue.push({
      type: "response.created",
      responseId,
    });

    const runPromise = this.executeRun(input, responseId, queue)
      .finally(() => {
        if (onAbort) {
          signal!.removeEventListener("abort", onAbort);
        }
        unsubscribe();
        queue.close();
      });

    for await (const event of queue) {
      yield event;
    }

    await runPromise;
  }

  public async dispose(): Promise<void> {
    if (!this.agent) {
      return;
    }

    this.agent.abort();
    await this.agent.waitForIdle();
    this.agent = null;
    this.toolHandler = null;
    this.model = null;
  }

  private async executeRun(
    input: ResponseInput,
    responseId: string,
    queue: AsyncEventQueue<ResponseEvent>,
  ): Promise<void> {
    if (!this.agent || !this.model) {
      queue.push({
        type: "response.error",
        error: "PiMonoAgentLoop is not initialized.",
      });
      return;
    }

    try {
      const messages = toAgentMessages(input, this.model);
      if (messages.length === 0) {
        throw new Error("ResponseInput must include at least one user, assistant, or tool message.");
      }

      this.agent.reset();
      this.agent.replaceMessages(messages);
      await this.agent.continue();
      await this.agent.waitForIdle();

      if (this.agent.state.error) {
        queue.push({
          type: "response.error",
          error: this.agent.state.error,
        });
        return;
      }

      const latestAssistantMessage = getLatestAssistantMessage(this.agent.state.messages);
      const outputText = toAssistantText(latestAssistantMessage);
      const usage = toTokenUsage(latestAssistantMessage?.usage);
      const output: ResponseOutput = {
        id: responseId,
        output: outputText,
      };

      if (usage) {
        output.usage = usage;
      }

      queue.push({
        type: "response.output_text.done",
        text: outputText,
      });
      queue.push({
        type: "response.completed",
        output,
      });
    } catch (error) {
      queue.push({
        type: "response.error",
        error: toErrorMessage(error),
      });
    }
  }
}
