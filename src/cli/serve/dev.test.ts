import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import { runDevCommand } from "./dev.js";
import {
  createBaseConfig,
  createServeHarness,
  createSignalMock,
  DEFAULT_CONFIG_PATH,
} from "./serve.test-helpers.js";

it("starts WebUI server and passes upgrade handler to HTTP server", async () => {
  const harness = createServeHarness();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const { signalProcess, fire } = createSignalMock();

  harness.startHttpServerMock.mockImplementation(async () => {
    setTimeout(() => fire("SIGINT"), 0);
    return { port: 5310, close: harness.closeServerMock };
  });

  const result = await runDevCommand(
    {
      configPath: DEFAULT_CONFIG_PATH,
      port: 5400,
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
      signalProcess,
      exit: vi.fn(),
      env: harness.env,
    },
  );

  expect(result.port).toBe(5310);
  expect(harness.createWebUIServerMock).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: harness.agent,
      commands: [],
    }),
  );
  expect(harness.startHttpServerMock).toHaveBeenCalledWith(
    expect.objectContaining({
      port: 5400,
      appFetch: expect.any(Function),
      handleUpgrade: expect.any(Function),
    }),
  );
  expect(harness.closeServerMock).toHaveBeenCalledTimes(1);
  expect(harness.webUIShutdownMock).toHaveBeenCalledTimes(1);
  expect(harness.agentShutdownMock).toHaveBeenCalledTimes(1);
});

it("handles SIGTERM with dev shutdown order http -> webui -> agent", async () => {
  const harness = createServeHarness();
  const exitMock = vi.fn();
  const { signalProcess, fire, listeners } = createSignalMock();
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
  harness.startHttpServerMock.mockImplementation(async () => {
    setTimeout(() => fire("SIGTERM"), 0);
    return { port: 5310, close: harness.closeServerMock };
  });

  await runDevCommand(
    { configPath: DEFAULT_CONFIG_PATH },
    {
      loadConfig: harness.loadConfigMock,
      loadSkills: harness.loadSkillsMock,
      generateSystemPrompt: harness.generateSystemPromptMock,
      defineAgentImpl: harness.defineAgentMock,
      createWebUIServerImpl: harness.createWebUIServerMock,
      startHttpServerImpl: harness.startHttpServerMock,
      signalProcess,
      exit: exitMock,
      env: harness.env,
    },
  );

  expect(shutdownOrder).toEqual([
    "http.close",
    "webui.shutdown",
    "agent.shutdown",
  ]);
  expect(exitMock).toHaveBeenCalledWith(0);
  expect(listeners.size).toBe(0);
});

it("fails before startup when required variables are missing", async () => {
  const config = createBaseConfig();
  config.prompt = {
    system: "Current user: {{user_name}}",
    variables: ["user_name"],
  };
  const harness = createServeHarness({ config, env: {} });

  await expect(
    runDevCommand(
      { configPath: DEFAULT_CONFIG_PATH },
      {
        loadConfig: harness.loadConfigMock,
        loadSkills: harness.loadSkillsMock,
        generateSystemPrompt: harness.generateSystemPromptMock,
        defineAgentImpl: harness.defineAgentMock,
        createWebUIServerImpl: harness.createWebUIServerMock,
        startHttpServerImpl: harness.startHttpServerMock,
        env: harness.env,
      },
    ),
  ).rejects.toThrow("Missing required init variables: user_name");
  expect(harness.defineAgentMock).not.toHaveBeenCalled();
});
