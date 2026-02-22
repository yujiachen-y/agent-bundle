#!/usr/bin/env node

import { defineCommand, runMain } from "citty";

import { DEFAULT_OUTPUT_DIR, runBuildCommand } from "./build.js";
import { runGenerateCommand } from "./generate.js";
import { loadBundleConfig } from "./load-bundle-config.js";

const DEFAULT_CONFIG_PATH = "./agent-bundle.yaml";

function resolveConfigPath(configArg: string | boolean | undefined): string {
  if (typeof configArg === "string" && configArg.length > 0) {
    return configArg;
  }

  return DEFAULT_CONFIG_PATH;
}

async function runStubCommand(command: "serve", configPath: string): Promise<void> {
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

const outputArg = {
  type: "string",
  description: "Directory to write generated artifacts.",
  default: DEFAULT_OUTPUT_DIR,
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

const generateCommand = defineCommand({
  meta: {
    name: "generate",
    description: "Generate bundle code (no Docker build).",
  },
  args: {
    config: configArg,
    output: {
      type: "string",
      description: "Directory to write generated artifacts. Defaults to node_modules/@agent-bundle/<name>/.",
    },
  },
  run: async ({ args }): Promise<void> => {
    await runGenerateCommand({
      configPath: resolveConfigPath(args.config),
      outputDir: typeof args.output === "string" ? args.output : undefined,
    });
  },
});

const buildCommand = defineCommand({
  meta: {
    name: "build",
    description: "Build deployable bundle artifacts.",
  },
  args: {
    config: configArg,
    output: outputArg,
  },
  run: async ({ args }): Promise<void> => {
    await runBuildCommand({
      configPath: resolveConfigPath(args.config),
      outputDir: typeof args.output === "string" ? args.output : DEFAULT_OUTPUT_DIR,
    });
  },
});

const mainCommand = defineCommand({
  meta: {
    name: "agent-bundle",
    description: "Bundle skills into a single deployable agent.",
  },
  subCommands: {
    serve: serveCommand,
    generate: generateCommand,
    build: buildCommand,
  },
});

runMain(mainCommand);
