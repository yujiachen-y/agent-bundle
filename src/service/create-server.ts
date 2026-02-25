import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import type { ResponseInput } from "../agent-loop/types.js";
import type { Agent } from "../agent/types.js";
import type { Command } from "../commands/types.js";
import { createCommandRoutes, type CommandRegistry } from "./command-routes.js";

type ErrorResponse = {
  error: {
    message: string;
  };
};

type ResponsesRequest = {
  input: ResponseInput;
  stream: boolean;
};

function createErrorResponse(c: Context, message: string, status: 400 | 500): Response {
  const payload: ErrorResponse = {
    error: { message },
  };
  return c.json(payload, status);
}

const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

const toolResultSchema = z.object({
  toolCallId: z.string(),
  output: z.unknown(),
  isError: z.boolean().optional(),
});

const responseInputMessageSchema = z.union([
  z.object({
    role: z.literal("system"),
    content: z.string(),
  }),
  z.object({
    role: z.literal("user"),
    content: z.string(),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string(),
    tool_calls: z.array(toolCallSchema).optional(),
  }),
  z.object({
    role: z.literal("tool"),
    content: z.string(),
    tool_results: z.array(toolResultSchema),
  }),
]);

const responsesRequestSchema = z.object({
  input: z.array(responseInputMessageSchema).min(1),
  stream: z.boolean().optional(),
});

function parseResponsesRequest(body: unknown): ResponsesRequest | null {
  const parsedRequest = responsesRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return null;
  }

  return {
    input: parsedRequest.data.input,
    stream: parsedRequest.data.stream === true,
  };
}

function createEventStreamResponse(c: Context, agent: Agent, input: ResponseInput): Response {
  return streamSSE(c, async (stream) => {
    try {
      for await (const event of agent.respondStream(input)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "response.error",
          error: message,
        }),
      });
    }
  });
}

export type CreateServerOptions = {
  commands?: readonly Command[];
};

export function createServer(agent: Agent, options?: CreateServerOptions): Hono {
  const app = new Hono();

  if (options?.commands && options.commands.length > 0) {
    const registry: CommandRegistry = { commands: options.commands };
    const commandRoutes = createCommandRoutes(agent, registry);
    app.route("/", commandRoutes);
  }

  app.get("/health", (c): Response => {
    return c.json({ status: "ok" });
  });

  app.post("/v1/responses", async (c): Promise<Response> => {
    let body: unknown;

    try {
      body = await c.req.json();
    } catch {
      return createErrorResponse(c, "Request body must be valid JSON.", 400);
    }

    const parsedRequest = parseResponsesRequest(body);
    if (!parsedRequest) {
      return createErrorResponse(
        c,
        "Invalid request body. Expected { input: ResponseInput, stream?: boolean }.",
        400,
      );
    }

    if (parsedRequest.stream) {
      return createEventStreamResponse(c, agent, parsedRequest.input);
    }

    try {
      const output = await agent.respond(parsedRequest.input);
      return c.json(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(c, message, 500);
    }
  });

  return app;
}
