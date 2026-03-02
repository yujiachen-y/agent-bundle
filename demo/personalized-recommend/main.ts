import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { PersonalizedRecommend as factory } from "@agent-bundle/personalized-recommend";
import { createServer as createAgentServer } from "agent-bundle/service";
import { resolveServicePort } from "agent-bundle/worktree-port";

// Structural type for response stream events (avoids importing non-exported type)
type StreamEvent = {
  type: string;
  toolCall?: { id: string; name: string };
  result?: { toolCallId: string; output: unknown; isError?: boolean };
  text?: string;
};

import { startProductServer } from "./mcp/product-server.js";

// ── Local disk persistence ───────────────────────────────────────
// Seed data (git-tracked) is loaded on startup to hydrate sandbox memory.
// Runtime changes are captured from tool outputs and persisted to a local
// file (gitignored). No extra LLM calls needed for persistence.
// Comment out ENABLE_PERSISTENCE to disable entirely.
const ENABLE_PERSISTENCE = true;
// const ENABLE_PERSISTENCE = false;

const DATA_DIR = fileURLToPath(new URL("./data", import.meta.url));
const SEED_FILE = `${DATA_DIR}/memory-snapshot.json`;
const LOCAL_FILE = `${DATA_DIR}/memory-local.json`;

type Snapshot = Record<string, Record<string, unknown>>;

function loadSnapshot(): Snapshot | null {
  if (!ENABLE_PERSISTENCE) return null;
  for (const file of [LOCAL_FILE, SEED_FILE]) {
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, "utf-8")) as Snapshot;
    } catch {
      /* skip corrupted file, try next */
    }
  }
  return null;
}

function writeLocalSnapshot(snapshot: Snapshot): void {
  const dir = dirname(LOCAL_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(LOCAL_FILE, JSON.stringify(snapshot, null, 2) + "\n");
}

// In-memory mirror of the sandbox memory, updated from tool outputs.
let localMirror: Snapshot = loadSnapshot() ?? {};

/** Extract the text payload from a raw tool output, unwrapping MCP content arrays. */
function extractToolText(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (typeof raw !== "object" || raw === null) return null;

  // MCP content-array format: { content: [{ type: "text", text: "..." }] }
  const content = (raw as Record<string, unknown>).content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((item): item is { type: string; text: string } =>
        typeof item === "object" && item !== null
        && (item as Record<string, unknown>).type === "text"
        && typeof (item as Record<string, unknown>).text === "string",
      )
      .map((item) => item.text);
    if (texts.length > 0) return texts.join("\n");
  }

  return null;
}

/** Parse a tool result output (string, MCP content array, or object) into a plain object. */
function parseToolOutput(raw: unknown): Record<string, unknown> | null {
  const text = extractToolText(raw);
  if (text !== null) {
    try { return JSON.parse(text) as Record<string, unknown>; } catch { /* ignore */ }
    return null;
  }

  if (typeof raw === "object" && raw !== null) return raw as Record<string, unknown>;
  return null;
}

/**
 * Scan a stream of ResponseEvents for memory_write / memory_persist results
 * and update localMirror accordingly. Returns the final text output.
 */
async function drainStream(
  stream: AsyncIterable<StreamEvent>,
): Promise<string> {
  // Track tool call names by ID so we can match done events
  const toolNames = new Map<string, string>();
  let outputText = "";

  for await (const event of stream) {
    if (event.type === "response.tool_call.created") {
      toolNames.set(event.toolCall.id, event.toolCall.name);
    }

    if (event.type === "response.tool_call.done" && !event.result.isError) {
      const name = toolNames.get(event.result.toolCallId);
      const parsed = parseToolOutput(event.result.output);
      if (!parsed) continue;

      if (name === "mcp__memory__memory_write" && parsed.ok && typeof parsed.userId === "string") {
        // Capture the written profile
        localMirror[parsed.userId] = parsed.profile as Record<string, unknown>;
      }

      if (name === "mcp__memory__memory_persist" && parsed.snapshot) {
        // Full snapshot available — replace mirror entirely
        localMirror = parsed.snapshot as Snapshot;
        if (parsed.cleared === true) {
          localMirror = {};
        }
      }
    }

    if (event.type === "response.output_text.done") {
      outputText = event.text;
    }
  }

  // Persist mirror to disk after every agent interaction
  if (ENABLE_PERSISTENCE && Object.keys(localMirror).length > 0) {
    writeLocalSnapshot(localMirror);
  }

  return outputText;
}

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

const productServer = await startProductServer();

const agent = await factory.init({
  variables: {} as Record<never, string>,
  mcpTokens: {
    products: process.env["PRODUCT_MCP_TOKEN"] ?? "demo",
  },
});

// ── Hydrate sandbox memory from local snapshot ───────────────────
if (ENABLE_PERSISTENCE && Object.keys(localMirror).length > 0) {
  const entries = Object.entries(localMirror);
  console.log(`[memory] hydrating ${entries.length} user(s) from disk`);
  const instructions = entries
    .map(
      ([uid, profile]) =>
        `- userId="${uid}" profile=${JSON.stringify(profile)}`,
    )
    .join("\n");
  const output = await drainStream(
    agent.respondStream([
      {
        role: "user",
        content: [
          "Call memory_write for each user below. Only execute the tool calls.",
          instructions,
        ].join("\n"),
      },
    ]),
  );
  agent.clearHistory();
  console.log(`[memory] hydration done: ${output.slice(0, 120)}`);
}

const app = new Hono();

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    mcp: {
      memory: "stdio (in-sandbox)",
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

  const output = await drainStream(
    agent.respondStream([
      {
        role: "user",
        content: [
          "Update the profile memory for this event.",
          `userId: ${request.userId}`,
          `event: ${request.event}`,
          "Use memory_read first, merge fields, then call memory_write.",
        ].join("\n"),
      },
    ]),
  );
  agent.clearHistory();

  return c.json({
    userId: request.userId,
    response: output,
  });
});

app.get("/api/recommendations/:userId", async (c) => {
  const userId = c.req.param("userId");
  if (!userId || userId.trim().length === 0) {
    return c.json({ error: "userId is required." }, 400);
  }

  const output = await drainStream(
    agent.respondStream([
      {
        role: "user",
        content: [
          `Generate product recommendations for userId=${userId}.`,
          "Use memory_read, product_search, and product_detail.",
          "Return strict JSON with this shape:",
          '{"userId":"<id>","recommendations":[{"id":"<id>","name":"<name>","reason":"<reason>"}]}',
        ].join("\n"),
      },
    ]),
  );
  agent.clearHistory();

  return c.json({
    userId,
    recommendations: parseJsonOutput(output),
    raw: output,
  });
});

app.post("/api/flush", async (c) => {
  const output = await drainStream(
    agent.respondStream([
      {
        role: "user",
        content: "Call memory_persist with clear=true and return the persistence summary.",
      },
    ]),
  );
  agent.clearHistory();

  return c.json({
    flushResult: parseJsonOutput(output),
    raw: output,
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

  // Local mirror is already persisted after each agent interaction,
  // so no extra LLM call needed on shutdown — just flush the mirror.
  if (ENABLE_PERSISTENCE && Object.keys(localMirror).length > 0) {
    writeLocalSnapshot(localMirror);
    console.log("[memory] final snapshot saved");
  }

  const closeResults = await Promise.allSettled([
    closeServer(server),
    agent.shutdown(),
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
