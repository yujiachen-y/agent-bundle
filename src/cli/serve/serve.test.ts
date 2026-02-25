import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import { runServeCommand } from "./serve.js";
import {
  createBaseConfig,
  createServeHarness,
  DEFAULT_CONFIG_PATH,
} from "./serve.test-helpers.js";

it("wires config, system prompt, agent init, http/webui, and tui flow", async () => {
  const harness = createServeHarness();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const config = createBaseConfig();

  const result = await runServeCommand(
    {
      configPath: DEFAULT_CONFIG_PATH,
      port: 4400,
      stdin,
      stdout,
      stderr,
    },
    {
      loadConfig: harness.loadConfigMock,
      loadSkills: harness.loadSkillsMock,
      generateSystemPrompt: harness.generateSystemPromptMock,
      defineAgentImpl: harness.defineAgentMock,
      createWebUIServerImpl: harness.createWebUIServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      serveTUIImpl: harness.serveTUIMock,
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
  expect(harness.startHttpServerMock).toHaveBeenCalledWith(
    expect.objectContaining({ port: 4400 }),
  );
  expect(harness.createWebUIServerMock).toHaveBeenCalledWith(
    expect.objectContaining({ commands: [] }),
  );
  expect(harness.serveTUIMock).toHaveBeenCalledWith(
    harness.agent,
    expect.objectContaining({ input: stdin, output: stdout, commands: [] }),
  );
  expect(harness.closeServerMock).toHaveBeenCalledTimes(1);
  expect(harness.webUIShutdownMock).toHaveBeenCalledTimes(1);
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

  await runServeCommand(
    { configPath: DEFAULT_CONFIG_PATH },
    {
      loadConfig: harness.loadConfigMock,
      loadSkills: harness.loadSkillsMock,
      generateSystemPrompt: harness.generateSystemPromptMock,
      defineAgentImpl: harness.defineAgentMock,
      createWebUIServerImpl: harness.createWebUIServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      serveTUIImpl: harness.serveTUIMock,
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
      createWebUIServerImpl: harness.createWebUIServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      serveTUIImpl: harness.serveTUIMock,
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
      createWebUIServerImpl: harness.createWebUIServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      serveTUIImpl: harness.serveTUIMock,
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
        createWebUIServerImpl: harness.createWebUIServerMock,
        startHttpServerImpl: harness.startHttpServerMock,
        serveTUIImpl: harness.serveTUIMock,
        env: harness.env,
      },
    ),
  ).rejects.toThrow("Missing required init variables: user_name");
  expect(harness.defineAgentMock).not.toHaveBeenCalled();
});

it("handles SIGINT with graceful shutdown and exits after cleanup", async () => {
  const harness = createServeHarness();
  const exitMock = vi.fn();
  const listeners = new Map<"SIGINT" | "SIGTERM", (signal: NodeJS.Signals) => void>();
  const signalProcess = {
    on: (signal: NodeJS.Signals, listener: (value: NodeJS.Signals) => void) => {
      if (signal === "SIGINT" || signal === "SIGTERM") {
        listeners.set(signal, listener);
      }
      return signalProcess;
    },
    off: (signal: NodeJS.Signals, listener: (value: NodeJS.Signals) => void) => {
      if ((signal === "SIGINT" || signal === "SIGTERM") && listeners.get(signal) === listener) {
        listeners.delete(signal);
      }
      return signalProcess;
    },
  } as unknown as Pick<NodeJS.Process, "on" | "off">;

  const shutdownOrder: string[] = [];
  harness.closeServerMock.mockImplementation(async () => {
    shutdownOrder.push("http.close");
  });
  harness.webUIShutdownMock.mockImplementation(() => {
    shutdownOrder.push("webui.shutdown");
  });
  harness.agentShutdownMock.mockImplementation(async () => {
    shutdownOrder.push("agent.shutdown");
  });
  harness.serveTUIMock.mockImplementation(async () => {
    const sigintListener = listeners.get("SIGINT");
    if (!sigintListener) {
      throw new Error("SIGINT listener was not registered.");
    }

    sigintListener("SIGINT");
    await Promise.resolve();
  });

  await runServeCommand(
    { configPath: DEFAULT_CONFIG_PATH },
    {
      loadConfig: harness.loadConfigMock,
      loadSkills: harness.loadSkillsMock,
      generateSystemPrompt: harness.generateSystemPromptMock,
      defineAgentImpl: harness.defineAgentMock,
      createWebUIServerImpl: harness.createWebUIServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      serveTUIImpl: harness.serveTUIMock,
      signalProcess,
      exit: exitMock,
      env: harness.env,
    },
  );

  await Promise.resolve();
  expect(shutdownOrder).toEqual([
    "http.close",
    "webui.shutdown",
    "agent.shutdown",
  ]);
  expect(exitMock).toHaveBeenCalledTimes(1);
  expect(exitMock).toHaveBeenCalledWith(0);
  expect(listeners.size).toBe(0);
});
