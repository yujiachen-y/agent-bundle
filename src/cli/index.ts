#!/usr/bin/env node

import { defineCommand, runMain } from "citty";

import { loadBundleConfig } from "./load-bundle-config.js";

const DEFAULT_CONFIG_PATH = "./agent-bundle.yaml";

type CommandName = "serve" | "build";

function resolveConfigPath(configArg: string | boolean | undefined): string {
  if (typeof configArg === "string" && configArg.length > 0) {
    return configArg;
  }

  return DEFAULT_CONFIG_PATH;
}

async function runStubCommand(command: CommandName, configPath: string): Promise<void> {
  const config = await loadBundleConfig(configPath);
  const output = {
    command,
    configPath,
    config,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const configArg = {
  type: "string",
  description: "Path to agent-bundle YAML config file.",
  default: DEFAULT_CONFIG_PATH,
} as const;

const serveCommand = defineCommand({
  meta: {
    name: "serve",
    description: "Run local development server (stub).",
  },
  args: {
    config: configArg,
  },
  run: async ({ args }): Promise<void> => {
    await runStubCommand("serve", resolveConfigPath(args.config));
  },
});

const buildCommand = defineCommand({
  meta: {
    name: "build",
    description: "Build deployable bundle artifacts (stub).",
  },
  args: {
    config: configArg,
  },
  run: async ({ args }): Promise<void> => {
    await runStubCommand("build", resolveConfigPath(args.config));
  },
});

const mainCommand = defineCommand({
  meta: {
    name: "agent-bundle",
    description: "Bundle skills into a single deployable agent.",
  },
  subCommands: {
    serve: serveCommand,
    build: buildCommand,
  },
});

runMain(mainCommand);
