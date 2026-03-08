import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { PersonalizedRecommend as factory } from "@agent-bundle/personalized-recommend";
import { createServer as createAgentServer } from "agent-bundle/service";
import { resolveServicePort } from "agent-bundle/worktree-port";

// ── Local disk persistence ───────────────────────────────────────
// Seed data (git-tracked) is loaded on startup and written into the sandbox
// via the preMount hook. After each agent response, memory files are read
// back from the sandbox and persisted locally.

const DATA_DIR = fileURLToPath(new URL("./data", import.meta.url));
const SEED_FILE = `${DATA_DIR}/memory-snapshot.json`;
const LOCAL_FILE = `${DATA_DIR}/memory-local.json`;
const CATALOG_FILE = `${DATA_DIR}/catalog.json`;

type Snapshot = Record<string, Record<string, unknown>>;

function loadSnapshot(): Snapshot | null {
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

// ── Sandbox file IO (captured in postMount) ──────────────────────

type FileIO = {
  read(path: string): Promise<string>;
  list(path: string): Promise<Array<{ name: string; type: string }>>;
};

let sandboxFile: FileIO | null = null;

async function syncMemoryFromSandbox(): Promise<void> {
  if (!sandboxFile) return;
  try {
    const entries = await sandboxFile.list("/memory");
    const snapshot: Snapshot = {};
    for (const entry of entries) {
      if (entry.type !== "file" || !entry.name.endsWith(".json")) continue;
      const content = await sandboxFile.read(`/memory/${entry.name}`);
      const userId = entry.name.replace(/\.json$/, "");
      snapshot[userId] = JSON.parse(content) as Record<string, unknown>;
    }
    if (Object.keys(snapshot).length > 0) {
      writeLocalSnapshot(snapshot);
    }
  } catch {
    /* sandbox may be shutting down */
  }
}

// ── Agent init ───────────────────────────────────────────────────

const agent = await factory.init({
  variables: {} as Record<never, string>,
  hooks: {
    preMount: async (io) => {
      const catalog = readFileSync(CATALOG_FILE, "utf-8");
      await io.file.write("/data/catalog.json", catalog);

      const snapshot = loadSnapshot();
      if (snapshot) {
        const entries = Object.entries(snapshot);
        await Promise.all(
          entries.map(([userId, profile]) =>
            io.file.write(`/memory/${userId}.json`, JSON.stringify(profile, null, 2)),
          ),
        );
        console.log(`[memory] hydrated ${entries.length} user(s) from disk`);
      }
    },
    postMount: async (io) => {
      sandboxFile = io.file;
    },
  },
});

// ── HTTP API ─────────────────────────────────────────────────────

type EventRequest = { userId: string; event: string };

function parseJsonOutput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    /* continue */
  }
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (!fenced) return null;
  try {
    return JSON.parse(fenced);
  } catch {
    return null;
  }
}

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

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
      ].join("\n"),
    },
  ]);
  agent.clearHistory();
  await syncMemoryFromSandbox();

  return c.json({ userId: request.userId, response: result.output });
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
        "Read the user profile and product catalog, then return recommendations.",
        "Return strict JSON with this shape:",
        '{"userId":"<id>","recommendations":[{"id":"<id>","name":"<name>","reason":"<reason>"}]}',
      ].join("\n"),
    },
  ]);
  agent.clearHistory();

  return c.json({
    userId,
    recommendations: parseJsonOutput(result.output),
    raw: result.output,
  });
});

app.route("/agent", createAgentServer(agent));

const port = await resolveServicePort(5);
const server = serve({ fetch: app.fetch, port });
console.log(`Personalized recommend demo ready at http://localhost:${port}`);

// ── Shutdown ─────────────────────────────────────────────────────

function closeServer(srv: unknown): Promise<void> {
  const closeFn = (srv as { close?: (cb: (err?: Error) => void) => void })?.close;
  if (typeof closeFn !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    closeFn((err) => (err ? reject(err) : resolve()));
  });
}

let shuttingDown = false;
async function shutdownAndExit(code: number, reason: string, error?: unknown): Promise<never> {
  if (shuttingDown) process.exit(code);
  shuttingDown = true;

  if (error !== undefined) {
    console.error(`[demo/personalized-recommend] ${reason}`);
    console.error(error);
  }

  await syncMemoryFromSandbox();
  const results = await Promise.allSettled([closeServer(server), agent.shutdown()]);
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[demo/personalized-recommend] Shutdown error:", r.reason);
    }
  }

  process.exit(code);
}

process.on("SIGINT", () => void shutdownAndExit(0, "Received SIGINT."));
process.on("SIGTERM", () => void shutdownAndExit(0, "Received SIGTERM."));
process.on("uncaughtException", (err) => void shutdownAndExit(1, "Uncaught exception.", err));
process.on("unhandledRejection", (err) => void shutdownAndExit(1, "Unhandled rejection.", err));
