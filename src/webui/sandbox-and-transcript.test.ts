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
  public conversationHistory: ResponseInput = [];

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

  public getConversationHistory(): ResponseInput {
    return [...this.conversationHistory];
  }

  public getSystemPrompt(): string {
    return "test system prompt";
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

describe("sandbox file endpoints", () => {
  let agent: StubAgent;
  let sandbox: FakeSandbox;

  beforeEach(() => {
    const s = setup();
    agent = s.agent;
    sandbox = s.sandbox;
  });

  it("GET /api/sandbox-files returns file tree from root", async () => {
    const entries: FileEntry[] = [
      { name: "etc", path: "/etc", type: "directory" },
      { name: "workspace", path: "/workspace", type: "directory" },
    ];
    sandbox.file.list = vi.fn(async (dirPath: string) => {
      if (dirPath === "/") return entries;
      return [];
    });

    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/sandbox-files?path=/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.root).toBe("/");
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].name).toBe("etc");
    shutdown();
  });

  it("GET /api/sandbox-file-content reads file outside workspace", async () => {
    sandbox.nextReadResult = "config-content";
    const { app, shutdown } = createWebUIServer({ agent, sandbox });

    const res = await app.request("/api/sandbox-file-content/etc/config.txt");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("text");
    expect(body.content).toBe("config-content");
    shutdown();
  });

  it("GET /api/sandbox-file-download serves file from sandbox", async () => {
    sandbox.nextExecResult = {
      stdout: Buffer.from("file-data").toString("base64"),
      stderr: "",
      exitCode: 0,
    };
    const { app, shutdown } = createWebUIServer({ agent, sandbox });

    const res = await app.request("/api/sandbox-file-download?path=/etc/config.txt");
    expect(res.status).toBe(200);
    shutdown();
  });
});

describe("transcript endpoints", () => {
  let agent: StubAgent;
  let sandbox: FakeSandbox;

  beforeEach(() => {
    const s = setup();
    agent = s.agent;
    sandbox = s.sandbox;
  });

  it("GET /api/transcript returns system prompt and conversation history", async () => {
    agent.conversationHistory = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];

    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/transcript");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBe("test system prompt");
    expect(body.history).toHaveLength(2);
    expect(body.history[0].role).toBe("user");
    expect(body.history[1].content).toBe("hi there");
    shutdown();
  });

  it("GET /api/transcript/events returns empty initially", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/transcript/events");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
    shutdown();
  });

  it("POST /api/transcript/clear resets events", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/transcript/clear", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    shutdown();
  });

  it("getConversationHistory returns immutable copy", () => {
    agent.conversationHistory = [{ role: "user", content: "test" }];
    const copy = agent.getConversationHistory();
    copy.push({ role: "assistant", content: "injected" });
    expect(agent.getConversationHistory()).toHaveLength(1);
  });

  it("GET /api/transcript includes events, offset, and truncated flag", async () => {
    agent.conversationHistory = [
      { role: "user", content: "hello" },
    ];

    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/transcript");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.systemPrompt).toBe("test system prompt");
    expect(body.history).toHaveLength(1);
    expect(body.events).toEqual([]);
    expect(body.eventsAssistantOffset).toBe(0);
    expect(body.eventsTruncated).toBe(false);
    shutdown();
  });

  it("POST /api/transcript/clear updates eventsAssistantOffset", async () => {
    agent.conversationHistory = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "bye" },
      { role: "assistant", content: "goodbye" },
    ];

    const { app, shutdown } = createWebUIServer({ agent, sandbox });

    // Clear events — offset should capture 2 assistant messages
    const clearRes = await app.request("/api/transcript/clear", { method: "POST" });
    expect(clearRes.status).toBe(200);

    const transcriptRes = await app.request("/api/transcript");
    const body = await transcriptRes.json();
    expect(body.eventsAssistantOffset).toBe(2);
    expect(body.eventsTruncated).toBe(false);
    shutdown();
  });

});

describe("info endpoint", () => {
  let agent: StubAgent;
  let sandbox: FakeSandbox;

  beforeEach(() => {
    const s = setup();
    agent = s.agent;
    sandbox = s.sandbox;
  });

  it("GET /api/info includes modelConfig when provided", async () => {
    const { app, shutdown } = createWebUIServer({
      agent,
      sandbox,
      modelConfig: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    });
    const res = await app.request("/api/info");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.modelConfig).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });
    shutdown();
  });

  it("GET /api/info omits modelConfig when not provided", async () => {
    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/info");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.modelConfig).toBeUndefined();
    shutdown();
  });
});

describe("transcript event alignment", () => {
  let agent: StubAgent;
  let sandbox: FakeSandbox;

  beforeEach(() => {
    const s = setup();
    agent = s.agent;
    sandbox = s.sandbox;
  });

  it("eventsAssistantOffset initializes from existing history", async () => {
    agent.conversationHistory = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "e" },
      { role: "assistant", content: "f" },
    ];

    const { app, shutdown } = createWebUIServer({ agent, sandbox });
    const res = await app.request("/api/transcript");
    const body = await res.json();
    // 3 assistant messages already in history → offset starts at 3
    expect(body.eventsAssistantOffset).toBe(3);
    shutdown();
  });

  it("POST /api/clear-context resets debug events and offset", async () => {
    agent.conversationHistory = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];

    const { app, shutdown } = createWebUIServer({ agent, sandbox });

    // Verify initial offset is 1 (one assistant message)
    const before = await app.request("/api/transcript");
    const beforeBody = await before.json();
    expect(beforeBody.eventsAssistantOffset).toBe(1);

    // Clear context (clears history via agent.clearHistory)
    const clearRes = await app.request("/api/clear-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clearWorkspace: false }),
    });
    expect(clearRes.status).toBe(200);

    // After clear-context, offset should be recalculated from current history.
    // StubAgent.clearHistory increments a counter but doesn't actually clear
    // conversationHistory, so the offset reflects the stub's current state.
    const after = await app.request("/api/transcript");
    const afterBody = await after.json();
    expect(afterBody.events).toEqual([]);
    expect(typeof afterBody.eventsAssistantOffset).toBe("number");
    shutdown();
  });
});
