import * as http from "node:http";
import { describe, expect, it, afterEach } from "vitest";
import { WebSocket } from "ws";

import type {
  ResponseEvent,
  ResponseInput,
  ResponseOutput,
} from "../agent-loop/types.js";
import type { Agent, AgentStatus, RespondStreamOptions } from "../agent/types.js";
import { FakeSandbox } from "../agent/agent.test-helpers.js";
import { createWebUIServer } from "./create-webui-server.js";

class StreamingStubAgent implements Agent {
  public readonly name = "ws-test-agent";
  private statusValue: AgentStatus = "ready";
  public respondStreamEvents: ResponseEvent[] = [];
  public clearHistoryCalls = 0;

  public get status(): AgentStatus { return this.statusValue; }

  public async respond(input: ResponseInput): Promise<ResponseOutput> {
    void input;
    return { id: "r1", output: "ok" };
  }

  public async *respondStream(
    input: ResponseInput,
    options?: RespondStreamOptions,
  ): AsyncIterable<ResponseEvent> {
    void input;
    void options;
    for (const event of this.respondStreamEvents) {
      yield event;
    }
  }

  public getConversationHistory(): ResponseInput {
    return [];
  }

  public getSystemPrompt(): string {
    return "";
  }

  public async shutdown(): Promise<void> {
    this.statusValue = "stopped";
  }

  public clearHistory(): void {
    this.clearHistoryCalls += 1;
  }
}

type TestContext = {
  server: http.Server;
  shutdown: () => void;
  port: number;
  agent: StreamingStubAgent;
};

function startTestServer(agent: StreamingStubAgent): Promise<TestContext> {
  const sandbox = new FakeSandbox();
  const { app, handleUpgrade, shutdown } = createWebUIServer({ agent, sandbox });

  const server = http.createServer((req, res) => {
    app.fetch(
      new Request(`http://localhost${req.url ?? "/"}`, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).filter(
            (kv): kv is [string, string] => typeof kv[1] === "string",
          ),
        ),
      }),
    ).then((response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return response.arrayBuffer();
    }).then((body) => {
      res.end(Buffer.from(body));
    }).catch(() => {
      res.writeHead(500).end();
    });
  });

  server.on("upgrade", handleUpgrade);

  return new Promise((resolve) => {
    // Use port 0 to let the OS assign a free port
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, shutdown, port, agent });
    });
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WS message timeout")), 5000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(typeof data === "string" ? data : data.toString("utf-8"));
    });
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    ws.on("close", () => resolve());
  });
}

function closeServer(ctx: TestContext): Promise<void> {
  ctx.shutdown();
  return new Promise((resolve) => {
    ctx.server.close(() => resolve());
  });
}

describe("createWebUIServer — WebSocket streaming", () => {
  let ctx: TestContext | null = null;

  afterEach(async () => {
    if (ctx) { await closeServer(ctx); ctx = null; }
  });

  it("upgrades /ws connections", async () => {
    const agent = new StreamingStubAgent();
    ctx = await startTestServer(agent);
    const ws = await connectWs(ctx.port);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("streams agent events to connected client", async () => {
    const agent = new StreamingStubAgent();
    agent.respondStreamEvents = [
      { type: "response.created", responseId: "r1" },
      { type: "response.output_text.delta", delta: "hello" },
      { type: "response.completed", output: { id: "r1", output: "hello" } },
    ];

    ctx = await startTestServer(agent);
    const ws = await connectWs(ctx.port);

    // Send a chat message to trigger agent streaming
    ws.send(JSON.stringify({
      type: "chat",
      input: [{ role: "user", content: "say hello" }],
    }));

    // Collect all streamed events
    const events: unknown[] = [];
    await new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const raw = typeof data === "string" ? data : data.toString("utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        events.push(parsed);
        if (parsed.type === "response.completed") resolve();
      });
      setTimeout(() => resolve(), 5000);
    });

    const types = events.map((e) => (e as Record<string, unknown>).type);
    expect(types).toContain("response.created");
    expect(types).toContain("response.output_text.delta");
    expect(types).toContain("response.completed");

    ws.close();
  });

  it("ignores malformed messages", async () => {
    const agent = new StreamingStubAgent();
    ctx = await startTestServer(agent);
    const ws = await connectWs(ctx.port);

    // Send garbage — should not crash
    ws.send("not json at all");
    ws.send(JSON.stringify({ type: "unknown" }));
    ws.send(JSON.stringify({ type: "chat" })); // missing input

    // Give server a moment to process
    await new Promise((r) => setTimeout(r, 100));

    // Connection should still be alive
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("cleans up WebSocket clients on shutdown", async () => {
    const agent = new StreamingStubAgent();
    ctx = await startTestServer(agent);
    const ws = await connectWs(ctx.port);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    const closePromise = waitForClose(ws);
    ctx.shutdown();
    await closePromise;

    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("broadcasts to multiple clients", async () => {
    const agent = new StreamingStubAgent();
    agent.respondStreamEvents = [
      { type: "response.output_text.delta", delta: "multi" },
      { type: "response.completed", output: { id: "r1", output: "multi" } },
    ];

    ctx = await startTestServer(agent);
    const ws1 = await connectWs(ctx.port);
    const ws2 = await connectWs(ctx.port);

    const msg1 = waitForMessage(ws1);
    const msg2 = waitForMessage(ws2);

    // Trigger from ws1
    ws1.send(JSON.stringify({
      type: "chat",
      input: [{ role: "user", content: "hi" }],
    }));

    const [raw1, raw2] = await Promise.all([msg1, msg2]);
    const parsed1 = JSON.parse(raw1) as Record<string, unknown>;
    const parsed2 = JSON.parse(raw2) as Record<string, unknown>;
    expect(parsed1.type).toBe("response.output_text.delta");
    expect(parsed2.type).toBe("response.output_text.delta");

    ws1.close();
    ws2.close();
  });
});

describe("createWebUIServer — WebSocket clear context", () => {
  let ctx: TestContext | null = null;

  afterEach(async () => {
    if (ctx) { await closeServer(ctx); ctx = null; }
  });

  it("handles clear_context messages and acknowledges completion", async () => {
    const agent = new StreamingStubAgent();
    ctx = await startTestServer(agent);
    const ws = await connectWs(ctx.port);

    ws.send(JSON.stringify({
      type: "clear_context",
      clearWorkspace: false,
    }));

    const receivedTypes: string[] = [];
    await new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const raw = typeof data === "string" ? data : data.toString("utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed.type === "string") {
          receivedTypes.push(parsed.type);
        }
        if (
          receivedTypes.includes("files_changed") &&
          receivedTypes.includes("clear_context.done")
        ) {
          resolve();
        }
      });
      setTimeout(() => resolve(), 5000);
    });

    expect(agent.clearHistoryCalls).toBe(1);
    expect(receivedTypes).toContain("files_changed");
    expect(receivedTypes).toContain("clear_context.done");
    ws.close();
  });
});
