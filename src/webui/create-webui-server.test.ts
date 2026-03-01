import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, vi } from "vitest";

import type { ResponseEvent, ResponseInput, ResponseOutput } from "../agent-loop/types.js";
import type { Agent, AgentStatus, RespondStreamOptions } from "../agent/types.js";
import { FakeSandbox } from "../agent/agent.test-helpers.js";
import type { FileEntry } from "../sandbox/types.js";
import { createWebUIServer } from "./create-webui-server.js";

class StubAgent implements Agent {
  public readonly name = "test-agent";
  private statusValue: AgentStatus = "ready";
  public respondStreamEvents: ResponseEvent[] = [];
  public clearHistoryCalls = 0;

  public get status(): AgentStatus {
    return this.statusValue;
  }

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

  public async shutdown(): Promise<void> {
    this.statusValue = "stopped";
  }

  public clearHistory(): void {
    this.clearHistoryCalls += 1;
  }
}

function setup() {
  const agent = new StubAgent();
  const sandbox = new FakeSandbox();
  return { agent, sandbox };
}

describe("createWebUIServer — shape and lifecycle", () => {
  it("creates a server with the expected shape", () => {
    const { agent, sandbox } = setup();
    const result = createWebUIServer({ agent, sandbox });

    expect(result.app).toBeDefined();
    expect(result.eventBus).toBeDefined();
    expect(result.handleUpgrade).toBeTypeOf("function");
    expect(result.shutdown).toBeTypeOf("function");
    result.shutdown();
  });

  it("shutdown cleans up event bus", () => {
    const { agent, sandbox } = setup();
    const { eventBus, shutdown } = createWebUIServer({ agent, sandbox });
    eventBus.subscribe(() => {});
    expect(eventBus.listenerCount()).toBe(1);
    shutdown();
    expect(eventBus.listenerCount()).toBe(0);
  });

  it("eventBus relays agent events", () => {
    const { agent, sandbox } = setup();
    const { eventBus, shutdown } = createWebUIServer({ agent, sandbox });
    const received: unknown[] = [];
    eventBus.subscribe((event) => received.push(event));

    const agentEvent: ResponseEvent = { type: "response.output_text.delta", delta: "test" };
    eventBus.emit({ type: "agent_event", event: agentEvent });
    expect(received).toHaveLength(1);
    shutdown();
  });
});

describe("createWebUIServer — static assets", () => {
  let agent: StubAgent;
  let sandbox: FakeSandbox;

  beforeEach(() => {
    const s = setup();
    agent = s.agent;
    sandbox = s.sandbox;
  });

  it("GET / serves index.html", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("agent-bundle");
    expect(html).toContain("<!DOCTYPE html>");
    shutdown();
  });

  it("GET /assets/styles.css serves CSS", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/assets/styles.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    shutdown();
  });

  it("GET /assets/app.js serves JavaScript", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    shutdown();
  });

  it("GET /assets/nonexistent returns 404", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/assets/does-not-exist.xyz");
    expect(res.status).toBe(404);
    shutdown();
  });

  it("rejects path traversal attempts", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/assets/..%2F..%2Fpackage.json");
    expect(res.status).toBe(404);
    shutdown();
  });
});

describe("createWebUIServer — core API endpoints", () => {
  let agent: StubAgent;
  let sandbox: FakeSandbox;

  beforeEach(() => {
    const s = setup();
    agent = s.agent;
    sandbox = s.sandbox;
  });

  it("GET /health returns ok", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    shutdown();
  });

  it("GET /api/files returns empty entries for empty sandbox", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual([]);
    shutdown();
  });

  it("GET /api/files returns file tree from sandbox", async () => {
    const entries: FileEntry[] = [
      { name: "hello.txt", path: "/workspace/hello.txt", type: "file" },
      { name: "src", path: "/workspace/src", type: "directory" },
    ];
    sandbox.file.list = vi.fn(async (dirPath: string) => {
      if (dirPath === "/workspace") return entries;
      return [];
    });

    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/files");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].name).toBe("hello.txt");
    expect(body.entries[1].name).toBe("src");
    expect(body.entries[1].children).toEqual([]);
    shutdown();
  });

  it("POST /v1/responses works through the base server", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: [{ role: "user", content: "hello" }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.output).toBe("ok");
    shutdown();
  });
});

describe("createWebUIServer — clear-context API", () => {
  let agent: StubAgent;
  let sandbox: FakeSandbox;

  beforeEach(() => {
    const s = setup();
    agent = s.agent;
    sandbox = s.sandbox;
  });

  it("POST /api/clear-context clears agent history", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/clear-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(agent.clearHistoryCalls).toBe(1);
    expect(sandbox.execCalls).toEqual([]);
    shutdown();
  });

  it("POST /api/clear-context clears workspace files when requested", async () => {
    const { app, eventBus, shutdown } = createWebUIServer({ agent, sandbox });
    const events: string[] = [];
    const unsubscribe = eventBus.subscribe((event) => events.push(event.type));

    const res = await app.request("/api/clear-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clearWorkspace: true }),
    });

    expect(res.status).toBe(200);
    expect(agent.clearHistoryCalls).toBe(1);
    expect(sandbox.execCalls[0]?.command).toContain(
      "find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +",
    );
    expect(events).toContain("files_changed");
    unsubscribe();
    shutdown();
  });

  it("POST /api/clear-context returns 500 when workspace clear fails", async () => {
    sandbox.nextExecResult = { stdout: "", stderr: "rm failed", exitCode: 1 };
    const { app, shutdown } = createWebUIServer({ agent, sandbox });

    const res = await app.request("/api/clear-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clearWorkspace: true }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("rm failed");
    shutdown();
  });
});

describe("createWebUIServer — public directory regression", () => {
  it("public directory co-located with module contains required assets", () => {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const publicDir = path.join(thisDir, "public");
    expect(fs.existsSync(path.join(publicDir, "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, "styles.css"))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, "app.js"))).toBe(true);
  });
});
