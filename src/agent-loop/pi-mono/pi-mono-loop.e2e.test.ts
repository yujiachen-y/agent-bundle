import { describe, expect, it } from "vitest";

import { PiMonoAgentLoop } from "./pi-mono-loop.js";
import { normalizeOllamaBaseUrl } from "./model.js";

type ProviderModel = {
  provider: "openai" | "anthropic" | "ollama" | "openrouter";
  model: string;
  env?: Record<string, string | undefined>;
};

const E2E_ENABLED = process.env.PI_MONO_E2E === "1";
const describeIfE2E = E2E_ENABLED ? describe : describe.skip;
const hasOpenAiKey = typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0;
const hasOpenRouterKey = typeof process.env.OPENROUTER_API_KEY === "string" && process.env.OPENROUTER_API_KEY.length > 0;
const anthropicToken = process.env.ANTHROPIC_OAUTH_TOKEN ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;
const hasAnthropicToken = typeof anthropicToken === "string" && anthropicToken.length > 0;
const hasOllama = process.env.PI_MONO_E2E_OLLAMA === "1";
const itIfOpenAi = hasOpenAiKey ? it : it.skip;
// OpenRouter is opt-in even when a key exists to avoid accidental paid E2E traffic.
const itIfOpenRouter = hasOpenRouterKey && process.env.PI_MONO_E2E_OPENROUTER === "1" ? it : it.skip;
const itIfAnthropic = hasAnthropicToken ? it : it.skip;
const itIfOllama = hasOllama ? it : it.skip;

async function withTemporaryEnv<T>(
  updates: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previousValues = Object.fromEntries(
    Object.keys(updates).map((key) => [key, process.env[key]]),
  );

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });

  try {
    return await callback();
  } finally {
    Object.entries(previousValues).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    });
  }
}

function resolveProviderModel(provider: "openai" | "anthropic" | "ollama" | "openrouter"): ProviderModel {
  if (provider === "openai") {
    return {
      provider,
      model: process.env.PI_MONO_E2E_OPENAI_MODEL ?? "gpt-5-mini",
    };
  }

  if (provider === "openrouter") {
    return {
      provider,
      model: process.env.PI_MONO_E2E_OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    };
  }

  if (provider === "ollama") {
    const configuredBaseUrl = process.env.PI_MONO_E2E_OLLAMA_BASE_URL
      ?? process.env.OLLAMA_BASE_URL
      ?? process.env.OLLAMA_HOST
      ?? "http://127.0.0.1:11434";
    const ollamaApiKey = process.env.OLLAMA_API_KEY ?? "ollama";

    return {
      provider,
      model: process.env.PI_MONO_E2E_OLLAMA_MODEL ?? "gpt-oss:20b",
      env: {
        OLLAMA_BASE_URL: normalizeOllamaBaseUrl(configuredBaseUrl),
        OLLAMA_API_KEY: ollamaApiKey,
      },
    };
  }

  if (anthropicToken) {
    return {
      provider,
      model: process.env.PI_MONO_E2E_ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
      env: {
        ANTHROPIC_OAUTH_TOKEN: anthropicToken,
      },
    };
  }

  throw new Error("Anthropic OAuth token is missing.");
}

async function runSmoke(model: ProviderModel): Promise<void> {
  const execute = async (): Promise<void> => {
    const loop = new PiMonoAgentLoop();
    await loop.init({
      systemPrompt: "You are concise. Follow the user instruction exactly.",
      model: {
        provider: model.provider,
        model: model.model,
      },
      toolHandler: async (call) => {
        throw new Error(`Unexpected tool call in smoke test: ${call.name}`);
      },
    });

    try {
      const events: Array<Record<string, unknown>> = [];
      for await (const event of loop.run([
        {
          role: "user",
          content: `Output exactly: pi-mono-ok-${model.provider}`,
        },
      ])) {
        events.push(event as unknown as Record<string, unknown>);
      }

      expect(events.some((event) => event.type === "response.error")).toBe(false);
      expect(events[events.length - 1].type).toBe("response.completed");

      const completed = events.find((event) => event.type === "response.completed");
      const output = String((completed?.output as { output?: string } | undefined)?.output ?? "");
      expect(output.toLowerCase()).toContain(`pi-mono-ok-${model.provider}`);
    } finally {
      await loop.dispose();
    }
  };

  if (model.env) {
    await withTemporaryEnv(model.env, execute);
    return;
  }

  await execute();
}

describeIfE2E("PiMonoAgentLoop E2E", () => {
  itIfOpenAi("runs end-to-end with OpenAI", async () => {
    await runSmoke(resolveProviderModel("openai"));
  }, 120_000);

  itIfOpenRouter("runs end-to-end with OpenRouter", async () => {
    await runSmoke(resolveProviderModel("openrouter"));
  }, 120_000);

  itIfAnthropic("runs end-to-end with Anthropic", async () => {
    await runSmoke(resolveProviderModel("anthropic"));
  }, 120_000);

  itIfOllama("runs end-to-end with Ollama", async () => {
    await runSmoke(resolveProviderModel("ollama"));
  }, 120_000);
});
