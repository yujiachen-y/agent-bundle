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
import type { Sandbox, FileEntry } from "../sandbox/types.js";
import { createServer } from "../service/create-server.js";
import { substituteArguments } from "../service/command-routes.js";
import { WebUIEventBus, type WebUIEvent } from "./event-bus.js";

export type WebUIServerOptions = {
  agent: Agent;
  sandbox: Sandbox;
  commands?: readonly Command[];
};

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};

type WsClient = {
  ws: WebSocket;
  unsubscribe: () => void;
};

const PUBLIC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);

const WORKSPACE_ROOT = "/workspace";

function toContentType(ext: string): string {
  switch (ext) {
    case ".html": return "text/html; charset=utf-8";
    case ".css":  return "text/css; charset=utf-8";
    case ".js":   return "application/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg":  return "image/svg+xml";
    case ".png":  return "image/png";
    default:      return "application/octet-stream";
  }
}

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

async function buildFileTree(sandbox: Sandbox, dirPath: string): Promise<FileTreeNode[]> {
  let entries: FileEntry[];
  try {
    entries = await sandbox.file.list(dirPath);
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    const node: FileTreeNode = {
      name: entry.name,
      path: entry.path,
      type: entry.type,
    };

    if (entry.type === "directory") {
      node.children = await buildFileTree(sandbox, entry.path);
    }

    nodes.push(node);
  }

  return nodes;
}

export function createWebUIServer(options: WebUIServerOptions): {
  app: Hono;
  eventBus: WebUIEventBus;
  handleUpgrade: (request: IncomingMessage, socket: unknown, head: Buffer) => void;
  shutdown: () => void;
} {
  const { agent, sandbox, commands } = options;
  const eventBus = new WebUIEventBus();
  const clients = new Set<WsClient>();

  // Start with the existing API server (health + /v1/responses + optional /commands)
  const app = createServer(agent, commands ? { commands } : undefined);

  // ─── File tree API ───
  app.get("/api/files", async (c): Promise<Response> => {
    const entries = await buildFileTree(sandbox, WORKSPACE_ROOT);
    return c.json({ entries });
  });

  // ─── File content API (for preview panel) ───
  app.get("/api/file-content/*", async (c): Promise<Response> => {
    const reqPath = c.req.path.replace("/api/file-content", "");
    const resolved = path.normalize(reqPath);

    // Path traversal protection: must stay within /workspace
    if (!resolved.startsWith(WORKSPACE_ROOT)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    try {
      const content = await sandbox.file.read(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"].includes(ext);

      if (isImage) {
        // Return base64-encoded image
        const base64 = typeof content === "string"
          ? Buffer.from(content).toString("base64")
          : Buffer.from(content as ArrayBuffer).toString("base64");
        return c.json({ type: "image", ext, base64 });
      }

      // Return text content
      const text = typeof content === "string" ? content : new TextDecoder().decode(content as ArrayBuffer);
      return c.json({ type: "text", ext, content: text });
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
  });

  // ─── Static file serving ───
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

  // ─── WebSocket server (standalone, not part of Hono routes) ───
  const wss = new WebSocketServer({ noServer: true });
  setupWsConnections(wss, clients, eventBus, agent, commands);

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
  commands: readonly Command[] | undefined,
): void {
  wss.on("connection", (ws: WebSocket) => {
    const unsubscribe = eventBus.subscribe((event: WebUIEvent) => {
      if (ws.readyState === ws.OPEN) {
        if (event.type === "agent_event") {
          ws.send(JSON.stringify(event.event));
        } else {
          ws.send(JSON.stringify({ type: event.type }));
        }
      }
    });

    const client: WsClient = { ws, unsubscribe };
    clients.add(client);

    if (commands && commands.length > 0) {
      const summaries = commands.map(toCommandSummary);
      ws.send(JSON.stringify({ type: "commands", commands: summaries }));
    }

    ws.on("message", (raw: Buffer | string) => {
      handleWsMessage(raw, ws, agent, eventBus, commands ?? []);
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
  eventBus: WebUIEventBus,
  commands: readonly Command[],
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
  } catch {
    return;
  }

  if (!isRecord(parsed)) return;

  if (parsed.type === "command") {
    const name = typeof parsed.name === "string" ? parsed.name : "";
    const args = typeof parsed.args === "string" ? parsed.args : "";
    const command = findCommand(commands, name);
    if (!command) {
      ws.send(JSON.stringify({ type: "command_error", name, error: "Command not found" }));
      return;
    }
    const content = substituteArguments(command.content, args);
    const input: ResponseInput = [{ role: "user", content }];
    void streamAgentResponse(agent, input, eventBus);
    return;
  }

  if (parsed.type !== "chat") return;

  const input = parsed.input;
  if (!Array.isArray(input) || input.length === 0) return;

  void streamAgentResponse(agent, input as ResponseInput, eventBus);
}

async function streamAgentResponse(
  agent: Agent,
  input: ResponseInput,
  eventBus: WebUIEventBus,
): Promise<void> {
  try {
    for await (const event of agent.respondStream(input)) {
      eventBus.emit({ type: "agent_event", event });
    }
  } catch (error) {
    const errorEvent: ResponseEvent = {
      type: "response.error",
      error: error instanceof Error ? error.message : String(error),
    };
    eventBus.emit({ type: "agent_event", event: errorEvent });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
