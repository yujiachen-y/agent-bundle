import { getModels, getProviders, type Api, type KnownProvider, type Model } from "@mariozechner/pi-ai";

import type { ModelConfig, ModelProvider } from "../types.js";

type SupportedPiProvider = "anthropic" | "openai" | "google" | "openrouter";

function toPiProvider(provider: ModelProvider): SupportedPiProvider {
  if (provider === "gemini") {
    return "google";
  }

  if (provider === "ollama") {
    throw new Error(
      "Model provider \"ollama\" is not supported by the current pi-mono runtime. Use openrouter/openai provider config instead.",
    );
  }

  return provider;
}

export function resolvePiModel(config: ModelConfig): Model<Api> {
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
