import { DockerSandbox } from "./providers/docker.js";
import { E2BSandbox } from "./providers/e2b.js";
import { K8sSandbox } from "./providers/kubernetes.js";
import type {
  CreateSandbox,
  Sandbox,
  SandboxConfig,
} from "./types.js";

const SUPPORTED_SANDBOX_PROVIDERS = ["e2b", "kubernetes", "docker"] as const;

function resolveProvider(config: SandboxConfig, mode: "build" | "serve"): string {
  if (mode === "serve" && config.serve?.provider) {
    return config.serve.provider;
  }

  return config.provider;
}

function withProvider(
  config: SandboxConfig,
  provider: SandboxConfig["provider"],
): SandboxConfig {
  return {
    ...config,
    provider,
  };
}

export const createSandbox: CreateSandbox = (
  config,
  hooks = {},
  options = {},
): Sandbox => {
  const mode = options.mode ?? "build";
  const provider = resolveProvider(config, mode);

  if (provider === "e2b") {
    return new E2BSandbox(withProvider(config, "e2b"), hooks);
  }

  if (provider === "kubernetes") {
    return new K8sSandbox(withProvider(config, "kubernetes"), hooks);
  }

  if (provider === "docker") {
    return new DockerSandbox(withProvider(config, "docker"), hooks);
  }

  throw new Error(
    `Unsupported sandbox provider "${provider}". Supported providers: ${SUPPORTED_SANDBOX_PROVIDERS.join(", ")}.`,
  );
};
