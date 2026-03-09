import type {
  ResponseEvent,
  ResponseInput,
  ResponseOutput,
} from "../agent-loop/types.js";
import type { Agent, AgentStatus, RespondStreamOptions } from "../agent/types.js";
import type { DevMetricsCollector } from "./dev-metrics.js";

/**
 * Wraps an Agent to record metrics into a DevMetricsCollector.
 *
 * The wrapper intercepts `respondStream` to measure durations and extract
 * token usage from `response.completed` events. It also captures tool-call
 * and MCP metrics from stream events when available.
 *
 * All other Agent methods delegate directly to the underlying agent.
 */
export function wrapAgentWithDevMetrics(
  agent: Agent,
  collector: DevMetricsCollector,
): Agent {
  return {
    get name(): string {
      return agent.name;
    },
    get status(): AgentStatus {
      return agent.status;
    },

    respond(input: ResponseInput): Promise<ResponseOutput> {
      return agent.respond(input);
    },

    respondStream(
      input: ResponseInput,
      options?: RespondStreamOptions,
    ): AsyncIterable<ResponseEvent> {
      const inner = agent.respondStream(input, options);
      return instrumentedStream(inner, collector);
    },

    getConversationHistory(): ResponseInput {
      return agent.getConversationHistory();
    },
    getSystemPrompt(): string {
      return agent.getSystemPrompt();
    },
    clearHistory(): void {
      agent.clearHistory();
    },
    shutdown(): Promise<void> {
      return agent.shutdown();
    },
  };
}

async function* instrumentedStream(
  inner: AsyncIterable<ResponseEvent>,
  collector: DevMetricsCollector,
): AsyncGenerator<ResponseEvent> {
  const startMs = performance.now();
  const toolStarts = new Map<string, number>();
  let hasError = false;

  collector.recordRespondStart();

  try {
    for await (const event of inner) {
      // Track tool call timing
      if (event.type === "response.tool_call.created") {
        toolStarts.set(event.toolCall.id, performance.now());
      } else if (event.type === "response.tool_call.done") {
        const toolStart = toolStarts.get(event.result.toolCallId);
        if (toolStart !== undefined) {
          const toolDuration = performance.now() - toolStart;
          // Determine tool name from the id prefix or use the id
          const isError = event.result.isError === true;
          collector.recordToolCall(
            event.result.toolCallId,
            toolDuration,
            isError,
          );
          toolStarts.delete(event.result.toolCallId);
        }
      }

      // Extract token usage from completed events
      if (event.type === "response.completed" && event.output.usage) {
        collector.recordTokenUsage(
          event.output.usage.inputTokens,
          event.output.usage.outputTokens,
        );
      }

      if (event.type === "response.error") {
        hasError = true;
      }

      yield event;
    }
  } catch (error) {
    hasError = true;
    throw error;
  } finally {
    const durationMs = performance.now() - startMs;
    collector.recordRespondEnd(durationMs, hasError);
  }
}
