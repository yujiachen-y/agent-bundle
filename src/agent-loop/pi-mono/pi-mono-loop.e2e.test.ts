import { describe, expect, it } from "vitest";

import { PiMonoAgentLoop } from "./pi-mono-loop.js";

type ProviderModel = {
  provider: "openai" | "anthropic";
  model: string;
};

const E2E_ENABLED = process.env.PI_MONO_E2E === "1";
const describeIfE2E = E2E_ENABLED ? describe : describe.skip;
const hasOpenAiKey = typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0;
const anthropicToken = process.env.ANTHROPIC_OAUTH_TOKEN ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;
const hasAnthropicToken = typeof anthropicToken === "string" && anthropicToken.length > 0;
const itIfOpenAi = hasOpenAiKey ? it : it.skip;
const itIfAnthropic = hasAnthropicToken ? it : it.skip;

function resolveProviderModel(provider: "openai" | "anthropic"): ProviderModel {
  if (provider === "openai") {
    return {
      provider,
      model: process.env.PI_MONO_E2E_OPENAI_MODEL ?? "gpt-5-mini",
    };
  }

  if (anthropicToken) {
    process.env.ANTHROPIC_OAUTH_TOKEN = anthropicToken;
    return {
      provider,
      model: process.env.PI_MONO_E2E_ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    };
  }

  throw new Error("Anthropic OAuth token is missing.");
}

async function runSmoke(model: ProviderModel): Promise<void> {
  const loop = new PiMonoAgentLoop();
  await loop.init({
    systemPrompt: "You are concise. Follow the user instruction exactly.",
    model,
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
}

describeIfE2E("PiMonoAgentLoop E2E", () => {
  itIfOpenAi("runs end-to-end with OpenAI", async () => {
    await runSmoke(resolveProviderModel("openai"));
  }, 120_000);

  itIfAnthropic("runs end-to-end with Anthropic", async () => {
    await runSmoke(resolveProviderModel("anthropic"));
  }, 120_000);
});
