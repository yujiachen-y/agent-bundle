import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import dotenv from "dotenv";
import { Agent } from "@mariozechner/pi-agent-core";
import {
  getModel,
  getModels,
  getProviders,
  getOAuthApiKey,
  getOAuthProviders,
} from "@mariozechner/pi-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const spikeDir = join(__dirname, "..");
const resultDir = join(spikeDir, "results");
const envPath = join(spikeDir, ".env");

dotenv.config({ path: envPath });

const runId = new Date().toISOString().replace(/[.:]/g, "-");

const ENV_VAR_HINTS = {
  "amazon-bedrock":
    "AWS_PROFILE | AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY | AWS_BEARER_TOKEN_BEDROCK | AWS_CONTAINER_CREDENTIALS_* | AWS_WEB_IDENTITY_TOKEN_FILE",
  anthropic: "ANTHROPIC_OAUTH_TOKEN | ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  "google-vertex": "GOOGLE_APPLICATION_CREDENTIALS (or ADC) + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION",
  openai: "OPENAI_API_KEY",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY (+ AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME)",
  xai: "XAI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  zai: "ZAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-cn": "MINIMAX_CN_API_KEY",
  huggingface: "HF_TOKEN",
  opencode: "OPENCODE_API_KEY",
  "kimi-coding": "KIMI_API_KEY",
  "github-copilot": "COPILOT_GITHUB_TOKEN | GH_TOKEN | GITHUB_TOKEN",
};

const preferredModels = {
  openai: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1"],
  anthropic: ["claude-sonnet-4-5", "claude-sonnet-4", "claude-3-7-sonnet"],
  "openai-codex": ["gpt-5.3-codex", "gpt-5.2-codex"],
};

function pickModelId(provider) {
  const models = getModels(provider);
  if (!models.length) {
    throw new Error(`No models found for provider: ${provider}`);
  }

  const preferred = preferredModels[provider] || [];
  for (const candidate of preferred) {
    const match = models.find((model) => model.id.includes(candidate));
    if (match) {
      return match.id;
    }
  }

  return models[0].id;
}

function getAssistantText(message) {
  if (!message || message.role !== "assistant") {
    return "";
  }

  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("")
    .trim();
}

function loadPiAuthFile() {
  const authPath = join(homedir(), ".pi", "agent", "auth.json");
  if (!existsSync(authPath)) {
    return { authPath, auth: null };
  }

  try {
    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    return { authPath, auth };
  } catch (error) {
    return {
      authPath,
      auth: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildOAuthCredentialMap(auth) {
  const credentials = {};
  if (!auth || typeof auth !== "object") {
    return credentials;
  }

  for (const [provider, value] of Object.entries(auth)) {
    if (value && typeof value === "object" && value.type === "oauth") {
      const { type: _type, ...rest } = value;
      credentials[provider] = rest;
    }
  }

  return credentials;
}

async function runAgentSmoke({ provider, apiKey, keyMode, prompt }) {
  const modelId = pickModelId(provider);
  const model = getModel(provider, modelId);

  const agent = new Agent({
    initialState: {
      systemPrompt: "You are a concise assistant. Reply in one short sentence.",
      model,
    },
    getApiKey:
      keyMode === "callback"
        ? async (targetProvider) => {
            if (targetProvider === provider) {
              return apiKey;
            }
            return undefined;
          }
        : undefined,
  });

  let streamText = "";
  agent.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      streamText += event.assistantMessageEvent.delta;
    }
  });

  const startedAt = new Date().toISOString();
  const timer = performance.now();

  try {
    await agent.prompt(prompt);

    const elapsedMs = performance.now() - timer;
    const assistantMessage = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
    const usage = assistantMessage?.usage || null;
    const tokenCounting =
      usage &&
      Number.isFinite(usage.input) &&
      Number.isFinite(usage.output) &&
      Number.isFinite(usage.totalTokens) &&
      usage.totalTokens > 0;

    return {
      ok: true,
      provider,
      modelId,
      keyMode,
      startedAt,
      elapsedMs,
      prompt,
      responseText: getAssistantText(assistantMessage),
      streamedTextLength: streamText.length,
      usage,
      tokenCounting,
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      modelId,
      keyMode,
      startedAt,
      elapsedMs: performance.now() - timer,
      prompt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function maybeRunCodexWithStoredOAuth() {
  const { authPath, auth, parseError } = loadPiAuthFile();
  const oauthProviders = getOAuthProviders().map((provider) => provider.id);

  const result = {
    supportedInPiMono: oauthProviders.includes("openai-codex"),
    authPath,
    authFileReadable: !!auth,
    parseError: parseError || null,
    attempted: false,
    skipped: false,
    skipReason: null,
    smoke: null,
  };

  if (!result.supportedInPiMono) {
    result.skipped = true;
    result.skipReason = "openai-codex is not registered in OAuth providers.";
    return result;
  }

  if (!auth || !auth["openai-codex"] || auth["openai-codex"].type !== "oauth") {
    result.skipped = true;
    result.skipReason = "No openai-codex OAuth credential in ~/.pi/agent/auth.json.";
    return result;
  }

  const credentialMap = buildOAuthCredentialMap(auth);
  result.attempted = true;

  try {
    const keyResult = await getOAuthApiKey("openai-codex", credentialMap);
    if (!keyResult?.apiKey) {
      result.skipped = true;
      result.skipReason = "Unable to resolve openai-codex API key from stored OAuth credentials.";
      return result;
    }

    result.smoke = await runAgentSmoke({
      provider: "openai-codex",
      apiKey: keyResult.apiKey,
      keyMode: "callback",
      prompt: "Reply with exactly: codex-ok",
    });
    return result;
  } catch (error) {
    result.smoke = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    return result;
  }
}

function buildProviderInventory() {
  const providers = getProviders().sort();
  const oauthProviders = new Set(getOAuthProviders().map((provider) => provider.id));

  return providers.map((provider) => ({
    provider,
    modelCount: getModels(provider).length,
    oauth: oauthProviders.has(provider),
    envOrCredentialHints: ENV_VAR_HINTS[provider] || null,
  }));
}

async function main() {
  const openAiKey = process.env.OPENAI_API_KEY;
  const claudeSetupToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  const result = {
    runId,
    executedAt: new Date().toISOString(),
    envFile: envPath,
    providerInventory: buildProviderInventory(),
    oauthProviders: getOAuthProviders().map((provider) => ({ id: provider.id, name: provider.name })),
    tests: {
      openaiApiKey: null,
      anthropicClaudeSetupToken: null,
      openaiCodexOAuth: null,
    },
  };

  if (openAiKey) {
    result.tests.openaiApiKey = await runAgentSmoke({
      provider: "openai",
      apiKey: openAiKey,
      keyMode: "callback",
      prompt: "Reply with exactly: openai-ok",
    });
  } else {
    result.tests.openaiApiKey = {
      ok: false,
      skipped: true,
      reason: "OPENAI_API_KEY is missing in .env",
    };
  }

  if (claudeSetupToken) {
    const original = process.env.ANTHROPIC_OAUTH_TOKEN;
    process.env.ANTHROPIC_OAUTH_TOKEN = claudeSetupToken;

    result.tests.anthropicClaudeSetupToken = await runAgentSmoke({
      provider: "anthropic",
      apiKey: undefined,
      keyMode: "env",
      prompt: "Reply with exactly: anthropic-ok",
    });

    if (original === undefined) {
      delete process.env.ANTHROPIC_OAUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_OAUTH_TOKEN = original;
    }
  } else {
    result.tests.anthropicClaudeSetupToken = {
      ok: false,
      skipped: true,
      reason: "CLAUDE_CODE_OAUTH_TOKEN is missing in .env",
    };
  }

  result.tests.openaiCodexOAuth = await maybeRunCodexWithStoredOAuth();

  if (!existsSync(resultDir)) {
    mkdirSync(resultDir, { recursive: true });
  }

  const outputPath = join(resultDir, `${runId}.json`);
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`runId: ${runId}`);
  console.log(`result: ${outputPath}`);
  console.log(`openaiApiKey.ok: ${Boolean(result.tests.openaiApiKey?.ok)}`);
  console.log(`anthropicClaudeSetupToken.ok: ${Boolean(result.tests.anthropicClaudeSetupToken?.ok)}`);
  console.log(`openaiCodexOAuth.supportedInPiMono: ${Boolean(result.tests.openaiCodexOAuth?.supportedInPiMono)}`);
  console.log(`openaiCodexOAuth.skipped: ${Boolean(result.tests.openaiCodexOAuth?.skipped)}`);
}

await main();
