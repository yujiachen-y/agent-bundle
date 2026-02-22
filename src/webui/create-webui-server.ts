import * as fs from "node:fs";
import * as path from "node:path";
import { type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import type { Context } from "hono";
import { WebSocketServer, type WebSocket } from "ws";

import type { ResponseEvent, ResponseInput } from "../agent-loop/types.js";
import type { Agent } from "../agent/types.js";
import type { Sandbox, FileEntry } from "../sandbox/types.js";
import { createServer } from "../service/create-server.js";
import { WebUIEventBus, type WebUIEvent } from "./event-bus.js";

export type WebUIServerOptions = {
  agent: Agent;
  sandbox: Sandbox;
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
  const { agent, sandbox } = options;
  const eventBus = new WebUIEventBus();
  const clients = new Set<WsClient>();

  // Start with the existing API server (health + /v1/responses)
  const app = createServer(agent);

  // ─── File tree API ───
  app.get("/api/files", async (c): Promise<Response> => {
    const entries = await buildFileTree(sandbox, WORKSPACE_ROOT);
    return c.json({ entries });
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

    ws.on("message", (raw: Buffer | string) => {
      handleWsMessage(raw, agent, eventBus);
    });

    ws.on("close", () => {
      unsubscribe();
      clients.delete(client);
    });
  });

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

function handleWsMessage(raw: Buffer | string, agent: Agent, eventBus: WebUIEventBus): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
  } catch {
    return;
  }

  if (!isRecord(parsed) || parsed.type !== "chat") return;

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
