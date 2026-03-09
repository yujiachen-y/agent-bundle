import * as fs from "node:fs";
import * as path from "node:path";
import { type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import type { Context } from "hono";
import { WebSocketServer, type WebSocket } from "ws";

import type { ResponseEvent, ResponseInput } from "../agent-loop/types.js";
import type { Agent } from "../agent/types.js";
import { findCommand, toCommandSummary } from "../commands/find.js";
import type { Command } from "../commands/types.js";
import type { Sandbox } from "../sandbox/types.js";
import { isRecord } from "../shared/errors.js";
import { createServer } from "../service/create-server.js";
import { substituteArguments } from "../service/command-routes.js";
import { devMetricsMiddleware, type DevMetricsCollector } from "./dev-metrics.js";
import { WebUIEventBus, type WebUIEvent } from "./event-bus.js";
import { clearContext, registerFileRoutes, toContentType } from "./file-routes.js";
import { registerSandboxFileRoutes } from "./sandbox-file-routes.js";

export type SkillInfo = {
  name: string;
  description: string;
};

export type WebUIServerOptions = {
  agent: Agent;
  sandbox: Sandbox;
  commands?: readonly Command[];
  skills?: readonly SkillInfo[];
  devMetrics?: DevMetricsCollector;
};

type WsClient = {
  ws: WebSocket;
  unsubscribe: () => void;
};

const PUBLIC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);

function serveStaticFile(c: Context, filePath: string): Response | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    return new Response(content, {
      headers: { "content-type": toContentType(ext) },
    });
  } catch {
    return null;
  }
}

const MAX_DEBUG_EVENTS = 10_000;

export function createWebUIServer(options: WebUIServerOptions): {
  app: Hono;
  eventBus: WebUIEventBus;
  handleUpgrade: (request: IncomingMessage, socket: unknown, head: Buffer) => void;
  shutdown: () => void;
} {
  const { agent, sandbox, commands, skills, devMetrics } = options;
  const eventBus = new WebUIEventBus();
  const clients = new Set<WsClient>();
  const debugEvents: ResponseEvent[] = [];
  const app = createServer(agent, commands ? { commands } : undefined);

  if (devMetrics) {
    app.use("*", devMetricsMiddleware(devMetrics));
  }

  app.get("/api/info", (c): Response => {
    return c.json({
      name: agent.name,
      status: agent.status,
      skills: skills ?? [],
    });
  });

  app.get("/api/transcript", (c): Response => {
    return c.json({
      systemPrompt: agent.getSystemPrompt(),
      history: agent.getConversationHistory(),
    });
  });

  app.get("/api/transcript/events", (c): Response => {
    return c.json({ events: debugEvents });
  });

  app.post("/api/transcript/clear", (c): Response => {
    debugEvents.length = 0;
    return c.json({ ok: true });
  });

  app.get("/api/metrics", (c): Response => {
    if (!devMetrics) return c.json({ enabled: false });
    return c.json({ enabled: true, ...devMetrics.snapshot() });
  });

  app.post("/api/metrics/reset", (c): Response => {
    if (!devMetrics) return c.json({ enabled: false });
    devMetrics.reset();
    return c.json({ ok: true });
  });

  registerFileRoutes(app, agent, sandbox, eventBus);
  registerSandboxFileRoutes(app, sandbox);

  app.get("/assets/:filename", (c): Response | Promise<Response> => {
    const filename = c.req.param("filename");
    const safeName = path.basename(filename);
    const filePath = path.join(PUBLIC_DIR, safeName);
    return serveStaticFile(c, filePath) ?? c.notFound();
  });

  app.get("/", (c): Response | Promise<Response> => {
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    return serveStaticFile(c, indexPath) ?? c.notFound();
  });

  const wss = new WebSocketServer({ noServer: true });
  setupWsConnections(wss, clients, eventBus, agent, sandbox, commands, debugEvents);

  function handleUpgrade(request: IncomingMessage, socket: unknown, head: Buffer): void {
    const url = request.url ?? "";
    if (url === "/ws" || url.startsWith("/ws?")) {
      wss.handleUpgrade(request, socket as import("node:net").Socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  }

  function shutdown(): void {
    for (const client of clients) {
      client.unsubscribe();
      client.ws.close();
    }
    clients.clear();
    wss.close();
    eventBus.dispose();
  }

  return { app, eventBus, handleUpgrade, shutdown };
}

function setupWsConnections(
  wss: WebSocketServer,
  clients: Set<WsClient>,
  eventBus: WebUIEventBus,
  agent: Agent,
  sandbox: Sandbox,
  commands: readonly Command[] | undefined,
  debugEvents: ResponseEvent[],
): void {
  wss.on("connection", (ws: WebSocket) => {
    const unsubscribe = eventBus.subscribe((event: WebUIEvent) => {
      if (ws.readyState !== ws.OPEN) return;
      if (event.type === "agent_event") {
        ws.send(JSON.stringify(event.event));
      } else {
        ws.send(JSON.stringify({ type: event.type }));
      }
    });

    const client: WsClient = { ws, unsubscribe };
    clients.add(client);

    if (commands && commands.length > 0) {
      const summaries = commands.map(toCommandSummary);
      ws.send(JSON.stringify({ type: "commands", commands: summaries }));
    }

    ws.on("message", (raw: Buffer | string) => {
      handleWsMessage(raw, ws, agent, sandbox, eventBus, commands ?? [], debugEvents);
    });

    ws.on("close", () => {
      unsubscribe();
      clients.delete(client);
    });
  });
}

function handleWsMessage(
  raw: Buffer | string,
  ws: WebSocket,
  agent: Agent,
  sandbox: Sandbox,
  eventBus: WebUIEventBus,
  commands: readonly Command[],
  debugEvents: ResponseEvent[],
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
  } catch {
    return;
  }

  if (!isRecord(parsed)) return;
  if (parsed.type === "command") {
    handleCommandMessage(parsed, ws, agent, eventBus, commands, debugEvents);
    return;
  }
  if (parsed.type === "clear_context") {
    handleClearContextMessage(parsed, ws, agent, sandbox, eventBus);
    return;
  }
  if (parsed.type === "get_transcript") {
    safeWsSend(ws, {
      type: "transcript",
      history: agent.getConversationHistory(),
      events: debugEvents,
    });
    return;
  }
  if (parsed.type !== "chat") return;

  const input = parsed.input;
  if (!Array.isArray(input) || input.length === 0) return;
  void streamAgentResponse(agent, input as ResponseInput, eventBus, debugEvents);
}

function handleCommandMessage(
  parsed: Record<string, unknown>,
  ws: WebSocket,
  agent: Agent,
  eventBus: WebUIEventBus,
  commands: readonly Command[],
  debugEvents: ResponseEvent[],
): void {
  const name = typeof parsed.name === "string" ? parsed.name : "";
  const args = typeof parsed.args === "string" ? parsed.args : "";
  const command = findCommand(commands, name);
  if (!command) {
    ws.send(JSON.stringify({ type: "command_error", name, error: "Command not found" }));
    return;
  }
  const content = substituteArguments(command.content, args);
  const input: ResponseInput = [{ role: "user", content }];
  void streamAgentResponse(agent, input, eventBus, debugEvents);
}

function handleClearContextMessage(
  parsed: Record<string, unknown>,
  ws: WebSocket,
  agent: Agent,
  sandbox: Sandbox,
  eventBus: WebUIEventBus,
): void {
  const clearWorkspace = parsed.clearWorkspace === true;
  void clearContext(agent, sandbox, eventBus, clearWorkspace)
    .then(() => {
      safeWsSend(ws, { type: "clear_context.done" });
    })
    .catch((error: unknown) => {
      safeWsSend(ws, {
        type: "clear_context.error",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function safeWsSend(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Connection may close between readyState check and send.
  }
}

async function streamAgentResponse(
  agent: Agent,
  input: ResponseInput,
  eventBus: WebUIEventBus,
  debugEvents: ResponseEvent[],
): Promise<void> {
  try {
    for await (const event of agent.respondStream(input)) {
      eventBus.emit({ type: "agent_event", event });
      if (debugEvents.length < MAX_DEBUG_EVENTS) {
        debugEvents.push(event);
      }
    }
  } catch (error) {
    const errorEvent: ResponseEvent = {
      type: "response.error",
      error: error instanceof Error ? error.message : String(error),
    };
    eventBus.emit({ type: "agent_event", event: errorEvent });
    if (debugEvents.length < MAX_DEBUG_EVENTS) {
      debugEvents.push(errorEvent);
    }
  }
}
