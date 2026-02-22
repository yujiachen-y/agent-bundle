import { describe, expect, it, vi } from "vitest";

import type { ResponseEvent, ResponseInput, ResponseOutput } from "../agent-loop/types.js";
import type { Agent } from "../agent/types.js";
import { createServer } from "./create-server.js";

function createAgentMock(): {
  agent: Agent;
  respond: ReturnType<typeof vi.fn<Agent["respond"]>>;
  respondStream: ReturnType<typeof vi.fn<Agent["respondStream"]>>;
} {
  const respond = vi.fn<Agent["respond"]>();
  const respondStream = vi.fn<Agent["respondStream"]>();

  return {
    agent: {
      name: "test-agent",
      status: "ready",
      respond,
      respondStream,
      shutdown: vi.fn<Agent["shutdown"]>().mockResolvedValue(undefined),
    },
    respond,
    respondStream,
  };
}

function createInput(content: string): ResponseInput {
  return [{ role: "user", content }];
}

function createOutput(): ResponseOutput {
  return {
    id: "resp-1",
    output: "hello",
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    },
  };
}

function createEventStream(events: ResponseEvent[]): AsyncIterable<ResponseEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe("createServer health", () => {
  it("returns health status", async () => {
    const { agent } = createAgentMock();
    const app = createServer(agent);

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});

describe("createServer non-streaming responses", () => {
  it("handles non-streaming response requests", async () => {
    const { agent, respond, respondStream } = createAgentMock();
    const input = createInput("hi");
    const output = createOutput();
    respond.mockResolvedValue(output);
    const app = createServer(agent);

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual(output);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(input);
    expect(respondStream).not.toHaveBeenCalled();
  });

  it("returns 500 for non-streaming agent errors", async () => {
    const { agent, respond, respondStream } = createAgentMock();
    const input = createInput("boom");
    respond.mockRejectedValue(new Error("agent failed"));
    const app = createServer(agent);

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { message: "agent failed" },
    });
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respondStream).not.toHaveBeenCalled();
  });
});

describe("createServer streaming responses", () => {
  it("streams response events over SSE when stream is true", async () => {
    const { agent, respond, respondStream } = createAgentMock();
    const input = createInput("stream");
    const events: ResponseEvent[] = [
      { type: "response.created", responseId: "resp-2" },
      { type: "response.output_text.delta", delta: "hello " },
      {
        type: "response.completed",
        output: {
          id: "resp-2",
          output: "hello world",
        },
      },
    ];
    respondStream.mockReturnValue(createEventStream(events));
    const app = createServer(agent);

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, stream: true }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(respond).not.toHaveBeenCalled();
    expect(respondStream).toHaveBeenCalledTimes(1);
    expect(respondStream).toHaveBeenCalledWith(input);

    const body = await response.text();
    const expected = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    expect(body).toBe(expected);
  });

  it("emits response.error event when streaming throws", async () => {
    const { agent, respond, respondStream } = createAgentMock();
    const input = createInput("stream-error");
    respondStream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "response.created", responseId: "resp-3" } satisfies ResponseEvent;
        throw new Error("stream failed");
      },
    });
    const app = createServer(agent);

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, stream: true }),
    });

    expect(response.status).toBe(200);
    expect(respond).not.toHaveBeenCalled();
    expect(respondStream).toHaveBeenCalledTimes(1);

    const body = await response.text();
    const expected = [
      'data: {"type":"response.created","responseId":"resp-3"}\n\n',
      'data: {"type":"response.error","error":"stream failed"}\n\n',
    ].join("");
    expect(body).toBe(expected);
  });
});

describe("createServer request validation", () => {
  it("returns 400 when body is not valid JSON", async () => {
    const { agent, respond, respondStream } = createAgentMock();
    const app = createServer(agent);

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { message: "Request body must be valid JSON." },
    });
    expect(respond).not.toHaveBeenCalled();
    expect(respondStream).not.toHaveBeenCalled();
  });

  it("returns 400 when request shape is invalid", async () => {
    const { agent, respond, respondStream } = createAgentMock();
    const app = createServer(agent);

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "not-an-array", stream: "yes" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: "Invalid request body. Expected { input: ResponseInput, stream?: boolean }.",
      },
    });
    expect(respond).not.toHaveBeenCalled();
    expect(respondStream).not.toHaveBeenCalled();
  });

  it("returns 400 when input array is empty", async () => {
    const { agent, respond, respondStream } = createAgentMock();
    const app = createServer(agent);

    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: [] }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: "Invalid request body. Expected { input: ResponseInput, stream?: boolean }.",
      },
    });
    expect(respond).not.toHaveBeenCalled();
    expect(respondStream).not.toHaveBeenCalled();
  });
});
