import type { ToolCall, ToolResult, TokenUsage } from "../agent-loop/types.js";

import {
  createAgentMetrics,
  createGenAiMetrics,
  createMcpMetrics,
  createToolMetrics,
  type AgentMetrics,
  type GenAiMetrics,
  type McpMetrics,
  type ToolMetrics,
} from "./metrics.js";
import { elapsed, now, withSpan } from "./tracing.js";
import {
  AgentAttributes,
  McpAttributes,
  type ObservabilityProvider,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Agent lifecycle hooks                                              */
/* ------------------------------------------------------------------ */

export type AgentObservabilityHooks = {
  onRespondStart: () => number;
  onRespondEnd: (startMs: number, error?: unknown) => void;
  onTokenUsage: (usage: TokenUsage) => void;
};

export function createAgentHooks(
  provider: ObservabilityProvider,
  agentName?: string,
): AgentObservabilityHooks {
  const agentMetrics: AgentMetrics = createAgentMetrics(provider.meter);
  const genAiMetrics: GenAiMetrics = createGenAiMetrics(provider.meter);
  const baseAttrs = agentName ? { [AgentAttributes.AGENT_NAME]: agentName } : {};

  return {
    onRespondStart(): number {
      agentMetrics.respondActive.add(1, baseAttrs);
      return now();
    },

    onRespondEnd(startMs: number, error?: unknown): void {
      const errorFlag = error !== undefined && error !== null;
      agentMetrics.respondActive.add(-1, baseAttrs);
      agentMetrics.respondDuration.record(elapsed(startMs), {
        ...baseAttrs,
        [AgentAttributes.AGENT_STATUS]: errorFlag ? "error" : "ok",
      });
    },

    onTokenUsage(usage: TokenUsage): void {
      genAiMetrics.inputTokens.add(usage.inputTokens, baseAttrs);
      genAiMetrics.outputTokens.add(usage.outputTokens, baseAttrs);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Tool call instrumentation                                          */
/* ------------------------------------------------------------------ */

export function createToolCallInstrumenter(provider: ObservabilityProvider) {
  const toolMetrics: ToolMetrics = createToolMetrics(provider.meter);

  return async function instrumentToolCall(
    call: ToolCall,
    execute: (call: ToolCall) => Promise<ToolResult>,
  ): Promise<ToolResult> {
    const startMs = now();
    let threw = false;

    try {
      const result = await withSpan(
        provider.tracer,
        `tool ${call.name}`,
        { [AgentAttributes.TOOL_NAME]: call.name },
        async () => execute(call),
      );

      if (result.isError) {
        toolMetrics.callErrors.add(1, {
          [AgentAttributes.TOOL_NAME]: call.name,
        });
      }

      return result;
    } catch (error) {
      threw = true;
      toolMetrics.callErrors.add(1, {
        [AgentAttributes.TOOL_NAME]: call.name,
      });
      throw error;
    } finally {
      toolMetrics.callDuration.record(elapsed(startMs), {
        [AgentAttributes.TOOL_NAME]: call.name,
        [AgentAttributes.TOOL_ERROR]: String(threw),
      });
    }
  };
}

/* ------------------------------------------------------------------ */
/*  MCP call instrumentation                                           */
/* ------------------------------------------------------------------ */

export function createMcpCallInstrumenter(provider: ObservabilityProvider) {
  const mcpMetrics: McpMetrics = createMcpMetrics(provider.meter);

  return async function instrumentMcpCall(
    serverName: string,
    toolName: string,
    execute: () => Promise<ToolResult>,
  ): Promise<ToolResult> {
    const startMs = now();
    let threw = false;

    try {
      const result = await withSpan(
        provider.tracer,
        `mcp ${serverName}/${toolName}`,
        {
          [McpAttributes.SERVER_NAME]: serverName,
          [McpAttributes.TOOL_NAME]: toolName,
        },
        async () => execute(),
      );

      if (result.isError) {
        mcpMetrics.callErrors.add(1, {
          [McpAttributes.SERVER_NAME]: serverName,
          [McpAttributes.TOOL_NAME]: toolName,
        });
      }

      return result;
    } catch (error) {
      threw = true;
      mcpMetrics.callErrors.add(1, {
        [McpAttributes.SERVER_NAME]: serverName,
        [McpAttributes.TOOL_NAME]: toolName,
      });
      throw error;
    } finally {
      mcpMetrics.callDuration.record(elapsed(startMs), {
        [McpAttributes.SERVER_NAME]: serverName,
        [McpAttributes.TOOL_NAME]: toolName,
        [McpAttributes.TOOL_ERROR]: String(threw),
      });
    }
  };
}
