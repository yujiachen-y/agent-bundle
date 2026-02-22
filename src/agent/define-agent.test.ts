import { beforeEach, expect, it, vi } from "vitest";

import type { AgentConfig, InitOptions } from "./types.js";

const createInitializedAgentMock = vi.fn();

vi.mock("./agent.js", () => ({
  createInitializedAgent: createInitializedAgentMock,
}));

const { defineAgent } = await import("./define-agent.js");

function buildConfig(): AgentConfig<"user_name"> {
  return {
    name: "invoice-processor",
    sandbox: {
      provider: "e2b",
      timeout: 900,
      resources: {
        cpu: 2,
        memory: "512MB",
      },
    },
    model: {
      provider: "openai",
      model: "gpt-5-mini",
    },
    systemPrompt: "Current user: {{user_name}}",
    variables: ["user_name"] as const,
  };
}

beforeEach(() => {
  createInitializedAgentMock.mockReset();
  createInitializedAgentMock.mockResolvedValue({
    name: "invoice-processor",
    status: "ready",
    respond: vi.fn(),
    respondStream: vi.fn(),
    shutdown: vi.fn(),
  });
});

it("returns factory name and delegates init to createInitializedAgent", async () => {
  const config = buildConfig();
  const factory = defineAgent(config);

  const initOptions: InitOptions<"user_name"> = {
    variables: {
      user_name: "Alice",
    },
  };

  const agent = await factory.init(initOptions);

  expect(factory.name).toBe("invoice-processor");
  expect(createInitializedAgentMock).toHaveBeenCalledTimes(1);
  expect(createInitializedAgentMock).toHaveBeenCalledWith(config, initOptions);
  expect(agent.name).toBe("invoice-processor");
});

it("throws when required init variables are missing", async () => {
  const factory = defineAgent(buildConfig());

  await expect(
    factory.init({
      variables: {} as Record<"user_name", string>,
    }),
  ).rejects.toThrow("Missing required init variables: user_name");
  expect(createInitializedAgentMock).not.toHaveBeenCalled();
});
