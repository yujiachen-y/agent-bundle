import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import { runServeCommand } from "./serve.js";
import {
  createBaseConfig,
  createServeHarness,
  createSignalMock,
  DEFAULT_CONFIG_PATH,
} from "./serve.test-helpers.js";

it("wires config, system prompt, agent init, and API server flow", async () => {
  const harness = createServeHarness();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const config = createBaseConfig();
  const { signalProcess, fire } = createSignalMock();

  harness.startHttpServerMock.mockImplementation(async () => {
    setTimeout(() => fire("SIGINT"), 0);
    return { port: 4310, close: harness.closeServerMock };
  });

  const result = await runServeCommand(
    {
      configPath: DEFAULT_CONFIG_PATH,
      port: 4400,
      stdout,
      stderr,
    },
    {
      loadConfig: harness.loadConfigMock,
      loadSkills: harness.loadSkillsMock,
      generateSystemPrompt: harness.generateSystemPromptMock,
      defineAgentImpl: harness.defineAgentMock,
      createServerImpl: harness.createServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      signalProcess,
      exit: vi.fn(),
      env: harness.env,
    },
  );

  expect(result.port).toBe(4310);
  expect(harness.loadConfigMock).toHaveBeenCalledWith(DEFAULT_CONFIG_PATH);
  // `loadAllSkills` receives dirname(configPath), which is `/tmp/agent-bundle-workspace`.
  expect(harness.loadSkillsMock).toHaveBeenCalledWith(config.skills, "/tmp/agent-bundle-workspace");
  expect(harness.generateSystemPromptMock).toHaveBeenCalledTimes(1);
  expect(harness.captured.agentConfig?.systemPrompt).toBe("generated-system-prompt");
  expect(harness.defineAgentMock).toHaveBeenCalledTimes(1);
  expect(harness.createServerMock).toHaveBeenCalledWith(
    harness.agent,
    expect.objectContaining({ commands: [] }),
  );
  expect(harness.createWebUIServerMock).not.toHaveBeenCalled();
  expect(harness.startHttpServerMock).toHaveBeenCalledWith(
    expect.objectContaining({ port: 4400, appFetch: expect.any(Function) }),
  );
  expect(harness.startHttpServerMock.mock.calls[0]?.[0]?.handleUpgrade).toBeUndefined();
  expect(harness.closeServerMock).toHaveBeenCalledTimes(1);
  expect(harness.webUIShutdownMock).not.toHaveBeenCalled();
  expect(harness.agentShutdownMock).toHaveBeenCalledTimes(1);
});

it("applies sandbox.serve.provider override when building serve-time agent config", async () => {
  const config = createBaseConfig();
  config.sandbox = {
    provider: "e2b",
    timeout: 900,
    resources: {
      cpu: 2,
      memory: "512MB",
    },
    e2b: {
      template: "invoice-template",
    },
    kubernetes: {
      image: "agent-bundle/execd:latest",
    },
    serve: {
      provider: "kubernetes",
    },
  };
  const harness = createServeHarness({ config });
  const { signalProcess, fire } = createSignalMock();

  harness.startHttpServerMock.mockImplementation(async () => {
    setTimeout(() => fire("SIGINT"), 0);
    return { port: 4310, close: harness.closeServerMock };
  });

  await runServeCommand(
    { configPath: DEFAULT_CONFIG_PATH },
    {
      loadConfig: harness.loadConfigMock,
      loadSkills: harness.loadSkillsMock,
      generateSystemPrompt: harness.generateSystemPromptMock,
      defineAgentImpl: harness.defineAgentMock,
      createServerImpl: harness.createServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      signalProcess,
      exit: vi.fn(),
      env: harness.env,
    },
  );

  expect(harness.captured.agentConfig?.sandbox.provider).toBe("kubernetes");
});

it("resolves init variables from env and lets --var override env values", async () => {
  const config = createBaseConfig();
  config.prompt = {
    system: "Current user: {{user_name}}, region: {{region}}",
    variables: ["user_name", "region"],
  };
  const harness = createServeHarness({
    config,
    env: {
      user_name: "Alice",
      AGENT_BUNDLE_VAR_REGION: "us",
    },
  });
  const { signalProcess, fire } = createSignalMock();

  harness.startHttpServerMock.mockImplementation(async () => {
    setTimeout(() => fire("SIGINT"), 0);
    return { port: 4310, close: harness.closeServerMock };
  });

  await runServeCommand(
    {
      configPath: DEFAULT_CONFIG_PATH,
      variableEntries: "region=cn",
    },
    {
      loadConfig: harness.loadConfigMock,
      loadSkills: harness.loadSkillsMock,
      generateSystemPrompt: harness.generateSystemPromptMock,
      defineAgentImpl: harness.defineAgentMock,
      createServerImpl: harness.createServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      signalProcess,
      exit: vi.fn(),
      env: harness.env,
    },
  );

  expect(harness.captured.initOptions?.variables).toEqual({
    user_name: "Alice",
    region: "cn",
  });
});

it("passes mcpTokens from --mcp-token and env fallbacks", async () => {
  const config = createBaseConfig();
  config.mcp = {
    servers: [
      {
        transport: "http",
        name: "refund-service",
        url: "https://example.com/mcp/refund",
        auth: "bearer",
      },
    ],
  };
  const harness = createServeHarness({
    config,
    env: {
      AGENT_BUNDLE_MCP_TOKEN_REFUND_SERVICE: "env-token",
    },
  });
  const { signalProcess, fire } = createSignalMock();

  harness.startHttpServerMock.mockImplementation(async () => {
    setTimeout(() => fire("SIGINT"), 0);
    return { port: 4310, close: harness.closeServerMock };
  });

  await runServeCommand(
    {
      configPath: DEFAULT_CONFIG_PATH,
      mcpTokenEntries: "refund-service=cli-token",
    },
    {
      loadConfig: harness.loadConfigMock,
      loadSkills: harness.loadSkillsMock,
      generateSystemPrompt: harness.generateSystemPromptMock,
      defineAgentImpl: harness.defineAgentMock,
      createServerImpl: harness.createServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      signalProcess,
      exit: vi.fn(),
      env: harness.env,
    },
  );

  expect(harness.captured.initOptions?.mcpTokens).toEqual({
    "refund-service": "cli-token",
  });
});

it("throws actionable error when required prompt variables are missing", async () => {
  const config = createBaseConfig();
  config.prompt = {
    system: "Current user: {{user_name}}",
    variables: ["user_name"],
  };
  const harness = createServeHarness({ config, env: {} });

  await expect(
    runServeCommand(
      { configPath: DEFAULT_CONFIG_PATH },
      {
        loadConfig: harness.loadConfigMock,
        loadSkills: harness.loadSkillsMock,
        generateSystemPrompt: harness.generateSystemPromptMock,
        defineAgentImpl: harness.defineAgentMock,
        createServerImpl: harness.createServerMock,
        startHttpServerImpl: harness.startHttpServerMock,
        env: harness.env,
      },
    ),
  ).rejects.toThrow("Missing required init variables: user_name");
  expect(harness.defineAgentMock).not.toHaveBeenCalled();
});

it("handles SIGINT with graceful shutdown and exits after cleanup", async () => {
  const harness = createServeHarness();
  const exitMock = vi.fn();
  const { signalProcess, fire, listeners } = createSignalMock();

  const shutdownOrder: string[] = [];
  harness.closeServerMock.mockImplementation(async () => {
    shutdownOrder.push("http.close");
  });
  harness.agentShutdownMock.mockImplementation(async () => {
    shutdownOrder.push("agent.shutdown");
  });

  harness.startHttpServerMock.mockImplementation(async () => {
    setTimeout(() => fire("SIGINT"), 0);
    return { port: 4310, close: harness.closeServerMock };
  });

  await runServeCommand(
    { configPath: DEFAULT_CONFIG_PATH },
    {
      loadConfig: harness.loadConfigMock,
      loadSkills: harness.loadSkillsMock,
      generateSystemPrompt: harness.generateSystemPromptMock,
      defineAgentImpl: harness.defineAgentMock,
      createServerImpl: harness.createServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      signalProcess,
      exit: exitMock,
      env: harness.env,
    },
  );

  expect(shutdownOrder).toEqual([
    "http.close",
    "agent.shutdown",
  ]);
  expect(exitMock).toHaveBeenCalledTimes(1);
  expect(exitMock).toHaveBeenCalledWith(0);
  expect(harness.createWebUIServerMock).not.toHaveBeenCalled();
  expect(harness.webUIShutdownMock).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});
