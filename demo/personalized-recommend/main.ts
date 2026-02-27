import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { PersonalizedRecommend as factory } from "@agent-bundle/personalized-recommend";
import { createServer as createAgentServer } from "agent-bundle/service";
import { resolveServicePort } from "agent-bundle/worktree-port";

import { startMemoryServer } from "./mcp/memory-server.js";
import { startProductServer } from "./mcp/product-server.js";

type EventRequest = {
  userId: string;
  event: string;
};

function parseJsonOutput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const fencedJson = raw.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (!fencedJson) {
    return null;
  }

  try {
    return JSON.parse(fencedJson);
  } catch {
    return null;
  }
}

async function closeServer(server: unknown): Promise<void> {
  const closeFn = (server as { close?: (cb: (error?: Error) => void) => void })?.close;
  if (typeof closeFn !== "function") {
    return;
  }

  await new Promise<void>((resolveClose, rejectClose) => {
    closeFn((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}

const memoryServer = await startMemoryServer();
const productServer = await startProductServer();

const agent = await factory.init({
  variables: {} as Record<never, string>,
  mcpTokens: {
    memory: "demo",
    products: "demo",
  },
});

const app = new Hono();

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    mcp: {
      memory: memoryServer.port,
      products: productServer.port,
    },
  });
});

app.post("/api/events", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON." }, 400);
  }

  const request = body as Partial<EventRequest>;
  if (typeof request.userId !== "string" || request.userId.trim().length === 0) {
    return c.json({ error: "userId is required." }, 400);
  }
  if (typeof request.event !== "string" || request.event.trim().length === 0) {
    return c.json({ error: "event is required." }, 400);
  }

  const result = await agent.respond([
    {
      role: "user",
      content: [
        "Update the profile memory for this event.",
        `userId: ${request.userId}`,
        `event: ${request.event}`,
        "Use memory_read first, merge fields, then call memory_write.",
      ].join("\n"),
    },
  ]);

  return c.json({
    userId: request.userId,
    response: result.output,
  });
});

app.get("/api/recommendations/:userId", async (c) => {
  const userId = c.req.param("userId");
  if (!userId || userId.trim().length === 0) {
    return c.json({ error: "userId is required." }, 400);
  }

  const result = await agent.respond([
    {
      role: "user",
      content: [
        `Generate product recommendations for userId=${userId}.`,
        "Use memory_read, product_search, and product_detail.",
        "Return strict JSON with this shape:",
        '{"userId":"<id>","recommendations":[{"id":"<id>","name":"<name>","reason":"<reason>"}]}',
      ].join("\n"),
    },
  ]);

  return c.json({
    userId,
    recommendations: parseJsonOutput(result.output),
    raw: result.output,
  });
});

app.post("/api/flush", async (c) => {
  const result = await agent.respond([
    {
      role: "user",
      content: "Call memory_persist with clear=true and return the persistence summary.",
    },
  ]);

  return c.json({
    flushResult: parseJsonOutput(result.output),
    raw: result.output,
  });
});

app.route("/agent", createAgentServer(agent));

const port = await resolveServicePort(5);
const server = serve({ fetch: app.fetch, port });
console.log(`Personalized recommend demo ready at http://localhost:${port}`);

let shuttingDown = false;
async function shutdownAndExit(code: number, reason: string, error?: unknown): Promise<never> {
  if (shuttingDown) {
    process.exit(code);
  }
  shuttingDown = true;

  if (error !== undefined) {
    console.error(`[demo/personalized-recommend] ${reason}`);
    console.error(error);
  }

  const closeResults = await Promise.allSettled([
    closeServer(server),
    agent.shutdown(),
    memoryServer.close(),
    productServer.close(),
  ]);

  for (const result of closeResults) {
    if (result.status === "rejected") {
      console.error("[demo/personalized-recommend] Shutdown error:");
      console.error(result.reason);
    }
  }

  process.exit(code);
}

process.on("SIGINT", () => {
  void shutdownAndExit(0, "Received SIGINT.");
});

process.on("SIGTERM", () => {
  void shutdownAndExit(0, "Received SIGTERM.");
});

process.on("uncaughtException", (error) => {
  void shutdownAndExit(1, "Uncaught exception.", error);
});

process.on("unhandledRejection", (error) => {
  void shutdownAndExit(1, "Unhandled promise rejection.", error);
});
