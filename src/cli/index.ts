#!/usr/bin/env node

import { defineCommand, runMain } from "citty";

import { DEFAULT_OUTPUT_DIR, runBuildCommand } from "./build/build.js";
import { runDeployCommand } from "./deploy/deploy.js";
import { runGenerateCommand } from "./generate/generate.js";
import { runDevCommand } from "./serve/dev.js";
import { runServeCommand } from "./serve/serve.js";

const DEFAULT_CONFIG_PATH = "./agent-bundle.yaml";

function resolveConfigPath(configArg: string | boolean | undefined): string {
  if (typeof configArg === "boolean") {
    throw new Error("--config requires a file path value.");
  }

  if (typeof configArg === "string" && configArg.length > 0) {
    return configArg;
  }

  return DEFAULT_CONFIG_PATH;
}

function resolvePort(portArg: string | boolean | undefined): number | undefined {
  if (typeof portArg === "boolean") {
    throw new Error("--port requires a numeric value.");
  }

  if (typeof portArg !== "string" || portArg.trim().length === 0) {
    return undefined;
  }

  if (!/^\d+$/.test(portArg.trim())) {
    throw new Error("Invalid --port value. Expected a numeric integer.");
  }

  const port = Number.parseInt(portArg, 10);
  if (port < 1 || port > 65_535) {
    throw new Error("Invalid --port value. Expected an integer between 1 and 65535.");
  }

  return port;
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

const portArg = {
  type: "string",
  description: "Port for the local HTTP server (auto-detected when omitted).",
} as const;

const keyValueArg = {
  type: "string",
  description: "Key-value entry in key=value format. Repeat flag or use comma-separated values.",
} as const;

const secretKeyArg = {
  type: "string",
  description: "Secret key name. Repeat flag or use comma-separated values. Values are read from environment variables.",
} as const;

const deployTargetArg = {
  type: "string",
  description: "Deployment target (aws).",
  default: "aws",
} as const;

const regionArg = {
  type: "string",
  description: "AWS region override for deploy.",
} as const;

const serveCommand = defineCommand({
  meta: {
    name: "serve",
    description: "Run production API server (no WebUI).",
  },
  args: {
    config: configArg,
    port: portArg,
    var: keyValueArg,
    mcpToken: keyValueArg,
  },
  run: async ({ args }): Promise<void> => {
    await runServeCommand({
      configPath: resolveConfigPath(args.config),
      port: resolvePort(args.port),
      variableEntries: args.var,
      mcpTokenEntries: args.mcpToken,
    });
  },
});

const devCommand = defineCommand({
  meta: {
    name: "dev",
    description: "Run local development server with WebUI.",
  },
  args: {
    config: configArg,
    port: portArg,
    var: keyValueArg,
    mcpToken: keyValueArg,
  },
  run: async ({ args }): Promise<void> => {
    await runDevCommand({
      configPath: resolveConfigPath(args.config),
      port: resolvePort(args.port),
      variableEntries: args.var,
      mcpTokenEntries: args.mcpToken,
    });
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

const deployCommand = defineCommand({
  meta: {
    name: "deploy",
    description: "Deploy built bundle artifacts to a target platform.",
  },
  args: {
    config: configArg,
    output: outputArg,
    target: deployTargetArg,
    region: regionArg,
    secret: secretKeyArg,
    teardown: {
      type: "boolean",
      description: "Delete AWS resources created by deploy.",
      default: false,
    },
  },
  run: async ({ args }): Promise<void> => {
    await runDeployCommand({
      configPath: resolveConfigPath(args.config),
      outputDir: typeof args.output === "string" ? args.output : DEFAULT_OUTPUT_DIR,
      target: args.target,
      region: args.region,
      secretEntries: args.secret,
      teardown: args.teardown === true,
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
    dev: devCommand,
    generate: generateCommand,
    build: buildCommand,
    deploy: deployCommand,
  },
});

runMain(mainCommand);
