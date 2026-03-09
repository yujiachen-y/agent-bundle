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
});
