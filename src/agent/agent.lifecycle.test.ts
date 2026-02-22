import { expect, it } from "vitest";

import type { ResponseEvent, ResponseInput } from "../agent-loop/index.js";
import { collectEvents, createHarness } from "./agent.test-helpers.js";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: () => {
      resolvePromise?.();
    },
  };
}

it("initializes sandbox and loop in order and fills prompt variables", async () => {
  const order: string[] = [];
  const harness = createHarness({ order });

  const originalStart = harness.sandbox.start.bind(harness.sandbox);
  harness.sandbox.start = async () => {
    order.push("sandbox.start");
    await originalStart();
  };

  const originalLoopInit = harness.loop.init.bind(harness.loop);
  harness.loop.init = async (config) => {
    order.push("loop.init");
    await originalLoopInit(config);
  };

  await harness.agent.initialize();

  expect(order).toEqual([
    "createSandbox",
    "createLoop",
    "sandbox.start",
    "loop.init",
  ]);
  expect(harness.loop.initConfigs[0].systemPrompt).toBe("Current user: Alice");
  expect(harness.agent.status).toBe("ready");
});

it("respond passes input to loop and appends successful output to history", async () => {
  const harness = createHarness();
  harness.loop.enqueueRun([
    { type: "response.created", responseId: "resp-1" },
    {
      type: "response.completed",
      output: {
        id: "resp-1",
        output: "first response",
      },
    },
  ]);
  harness.loop.enqueueRun([
    { type: "response.created", responseId: "resp-2" },
    {
      type: "response.completed",
      output: {
        id: "resp-2",
        output: "second response",
      },
    },
  ]);

  await harness.agent.initialize();

  const first = await harness.agent.respond([{ role: "user", content: "hello" }]);
  const second = await harness.agent.respond([{ role: "user", content: "follow up" }]);

  expect(first.output).toBe("first response");
  expect(second.output).toBe("second response");
  expect(harness.loop.runInputs[0]).toEqual([{ role: "user", content: "hello" }]);
  expect(harness.loop.runInputs[1]).toEqual([
    { role: "user", content: "hello" },
    { role: "assistant", content: "first response" },
    { role: "user", content: "follow up" },
  ]);
  expect(harness.agent.status).toBe("ready");
});

it("respond throws when loop emits response.error", async () => {
  const harness = createHarness();
  harness.loop.enqueueRun([
    { type: "response.created", responseId: "resp-1" },
    { type: "response.error", error: "llm failure" },
  ]);

  await harness.agent.initialize();

  await expect(harness.agent.respond([{ role: "user", content: "hello" }])).rejects.toThrow(
    "llm failure",
  );
});

it("uses session history as prior loop input", async () => {
  const harness = createHarness({
    initOverrides: {
      session: {
        conversationHistory: [
          { role: "user", content: "earlier" },
          { role: "assistant", content: "previous answer" },
        ],
      },
    },
  });

  harness.loop.enqueueRun([
    { type: "response.created", responseId: "resp-1" },
    {
      type: "response.completed",
      output: {
        id: "resp-1",
        output: "new answer",
      },
    },
  ]);

  await harness.agent.initialize();
  await collectEvents(harness.agent.respondStream([{ role: "user", content: "new input" }]));

  expect(harness.loop.runInputs[0]).toEqual([
    { role: "user", content: "earlier" },
    { role: "assistant", content: "previous answer" },
    { role: "user", content: "new input" },
  ]);
});

it("shuts down in order loop then mcp then sandbox and is idempotent", async () => {
  const order: string[] = [];
  const harness = createHarness({
    configOverrides: {
      mcp: [{ name: "refund", url: "https://example.com/mcp", auth: "bearer" }],
    },
    mcpClientManager: {
      tools: [],
      callTool: async (call) => ({ toolCallId: call.id, output: "ok" }),
      dispose: async () => {
        order.push("mcp.dispose");
      },
    },
  });

  harness.loop.dispose = async () => {
    order.push("loop.dispose");
  };
  harness.sandbox.shutdown = async () => {
    order.push("sandbox.shutdown");
    harness.sandbox.status = "stopped";
  };

  await harness.agent.initialize();
  await harness.agent.shutdown();
  await harness.agent.shutdown();

  expect(order).toEqual(["loop.dispose", "mcp.dispose", "sandbox.shutdown"]);
  expect(harness.agent.status).toBe("stopped");
});

it("cleans up initialized resources when loop init fails", async () => {
  const order: string[] = [];
  const harness = createHarness({ order });
  harness.loop.setInitError(new Error("loop init failed"));

  harness.loop.dispose = async () => {
    order.push("loop.dispose");
  };
  harness.sandbox.shutdown = async () => {
    order.push("sandbox.shutdown");
    harness.sandbox.status = "stopped";
  };

  await expect(harness.agent.initialize()).rejects.toThrow("loop init failed");
  expect(order).toContain("loop.dispose");
  expect(order).toContain("sandbox.shutdown");
  expect(harness.agent.status).toBe("stopped");
});

it("fails fast before provisioning sandbox when model api key is missing", async () => {
  const originalOauthToken = process.env.ANTHROPIC_OAUTH_TOKEN;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_OAUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const order: string[] = [];
    const harness = createHarness({
      order,
      configOverrides: {
        model: {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
        },
      },
    });

    await expect(harness.agent.initialize()).rejects.toThrow(
      'Missing credentials for provider "anthropic". Set ANTHROPIC_OAUTH_TOKEN or ANTHROPIC_API_KEY before starting the agent.',
    );
    expect(order).toEqual([]);
    expect(harness.sandbox.startCount).toBe(0);
    expect(harness.loop.initConfigs).toEqual([]);
    expect(harness.agent.status).toBe("stopped");
  } finally {
    if (originalOauthToken === undefined) {
      delete process.env.ANTHROPIC_OAUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_OAUTH_TOKEN = originalOauthToken;
    }

    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  }
});

it("accepts Anthropic OAuth token during startup validation", async () => {
  const originalOauthToken = process.env.ANTHROPIC_OAUTH_TOKEN;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_OAUTH_TOKEN = "oauth-token";
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const harness = createHarness({
      configOverrides: {
        model: {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
        },
      },
    });

    await harness.agent.initialize();
    expect(harness.sandbox.startCount).toBe(1);
    expect(harness.loop.initConfigs.length).toBe(1);
    expect(harness.agent.status).toBe("ready");
  } finally {
    if (originalOauthToken === undefined) {
      delete process.env.ANTHROPIC_OAUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_OAUTH_TOKEN = originalOauthToken;
    }

    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  }
});

it("accepts GEMINI_API_KEY for gemini provider startup validation", async () => {
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "gemini-key";

  try {
    const harness = createHarness({
      configOverrides: {
        model: {
          provider: "gemini",
          model: "gemini-2.5-flash-lite-preview-06-17",
        },
      },
    });

    await harness.agent.initialize();
    expect(harness.sandbox.startCount).toBe(1);
    expect(harness.loop.initConfigs.length).toBe(1);
    expect(harness.agent.status).toBe("ready");
  } finally {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  }
});

it("guards respondStream when agent status is stopped", async () => {
  const harness = createHarness();

  await expect(
    collectEvents(harness.agent.respondStream([{ role: "user", content: "before init" }])),
  ).rejects.toThrow("Agent is stopped.");

  await harness.agent.initialize();
  await harness.agent.shutdown();

  await expect(
    collectEvents(harness.agent.respondStream([{ role: "user", content: "after shutdown" }])),
  ).rejects.toThrow("Agent is stopped.");
});

it("guards respondStream when another response is already running", async () => {
  const harness = createHarness();
  const deferred = createDeferred();

  harness.loop.run = async function* (input: ResponseInput): AsyncIterable<ResponseEvent> {
    harness.loop.runInputs.push(input);
    yield {
      type: "response.created",
      responseId: "resp-running",
    };
    await deferred.promise;
    yield {
      type: "response.completed",
      output: {
        id: "resp-running",
        output: "done",
      },
    };
  };

  await harness.agent.initialize();

  const firstStream = harness.agent.respondStream([{ role: "user", content: "first" }]);
  const firstEvent = await firstStream.next();
  expect(firstEvent.value).toMatchObject({ type: "response.created" });

  await expect(
    collectEvents(harness.agent.respondStream([{ role: "user", content: "second" }])),
  ).rejects.toThrow("Agent is already running.");

  deferred.resolve();
  const remainingEvents = await collectEvents(firstStream);
  expect(remainingEvents[0]).toMatchObject({ type: "response.completed" });
  expect(harness.agent.status).toBe("ready");
});
