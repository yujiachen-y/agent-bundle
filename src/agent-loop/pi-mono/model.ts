import { getModels, getProviders, type Api, type KnownProvider, type Model } from "@mariozechner/pi-ai";

import type { ModelConfig, ModelProvider } from "../types.js";

type SupportedPiProvider = "anthropic" | "openai" | "google" | "openrouter";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_OLLAMA_CONTEXT_WINDOW = 128_000;
const DEFAULT_OLLAMA_MAX_TOKENS = 32_000;

function toPiProvider(provider: Exclude<ModelProvider, "ollama">): SupportedPiProvider {
  if (provider === "gemini") {
    return "google";
  }

  return provider;
}

type OllamaConfig = NonNullable<ModelConfig["ollama"]>;

export function normalizeOllamaBaseUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");

  if (normalizedBaseUrl.endsWith("/v1")) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/v1`;
}

export function resolveOllamaBaseUrl(config?: OllamaConfig): string {
  const configuredBaseUrl = config?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_BASE_URL;
  return normalizeOllamaBaseUrl(configuredBaseUrl);
}

function createOllamaModel(modelId: string, config?: OllamaConfig): Model<"openai-completions"> {
  const contextWindow = config?.contextWindow ?? DEFAULT_OLLAMA_CONTEXT_WINDOW;
  const maxTokens = config?.maxTokens ?? DEFAULT_OLLAMA_MAX_TOKENS;

  return {
    id: modelId,
    name: `${modelId} (Ollama)`,
    api: "openai-completions",
    provider: "ollama",
    baseUrl: resolveOllamaBaseUrl(config),
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow,
    maxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
      supportsStrictMode: false,
    },
  };
}

export function resolvePiModel(config: ModelConfig): Model<Api> {
  if (config.provider === "ollama") {
    return createOllamaModel(config.model, config.ollama);
  }

  const provider = toPiProvider(config.provider);
  const knownProvider: KnownProvider = provider;

  const providers = getProviders();
  if (!providers.includes(knownProvider)) {
    throw new Error(
      `Unsupported model provider: ${config.provider}. Available providers: ${providers.join(", ")}`,
    );
  }

  const availableModels = getModels(knownProvider);
  const exactMatch = availableModels.find((model) => model.id === config.model);
  if (!exactMatch) {
    const sampledModelIds = availableModels
      .slice(0, 8)
      .map((model) => model.id)
      .join(", ");
    throw new Error(
      `Model ${config.model} is not available for provider ${config.provider}. Known models include: ${sampledModelIds}`,
    );
  }

  return exactMatch;
}
