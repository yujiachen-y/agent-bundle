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
import { buildProviderInventory, pickModelId } from "./lib/provider_helpers.mjs";
import {
  buildOAuthCredentialMap,
  buildSkippedTestResult,
  getAssistantText,
  hasTokenCounting,
  withTemporaryEnvVar,
} from "./lib/runtime_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const spikeDir = join(__dirname, "..");
const resultDir = join(spikeDir, "results");
const envPath = join(spikeDir, ".env");

dotenv.config({ path: envPath });

const runId = new Date().toISOString().replace(/[.:]/g, "-");

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

async function runAgentSmoke({ provider, apiKey, keyMode, prompt }) {
  const modelId = pickModelId(provider, getModels(provider));
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
      tokenCounting: hasTokenCounting(usage),
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

function createCodexOAuthResult({ authPath, auth, parseError, oauthProviderIds }) {
  return {
    supportedInPiMono: oauthProviderIds.includes("openai-codex"),
    authPath,
    authFileReadable: Boolean(auth),
    parseError: parseError || null,
    attempted: false,
    skipped: false,
    skipReason: null,
    smoke: null,
  };
}

async function maybeRunCodexWithStoredOAuth(oauthProviderIds) {
  const { authPath, auth, parseError } = loadPiAuthFile();
  const result = createCodexOAuthResult({ authPath, auth, parseError, oauthProviderIds });

  if (!result.supportedInPiMono) {
    result.skipped = true;
    result.skipReason = "openai-codex is not registered in OAuth providers.";
    return result;
  }

  const credentialMap = buildOAuthCredentialMap(auth);
  if (!credentialMap["openai-codex"]) {
    result.skipped = true;
    result.skipReason = "No openai-codex OAuth credential in ~/.pi/agent/auth.json.";
    return result;
  }

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

async function runAnthropicClaudeSetupSmoke(claudeSetupToken) {
  if (!claudeSetupToken) {
    return buildSkippedTestResult("CLAUDE_CODE_OAUTH_TOKEN is missing in .env");
  }

  return withTemporaryEnvVar("ANTHROPIC_OAUTH_TOKEN", claudeSetupToken, async () => runAgentSmoke({
    provider: "anthropic",
    apiKey: undefined,
    keyMode: "env",
    prompt: "Reply with exactly: anthropic-ok",
  }));
}

async function runOpenAiApiKeySmoke(openAiKey) {
  if (!openAiKey) {
    return buildSkippedTestResult("OPENAI_API_KEY is missing in .env");
  }

  return runAgentSmoke({
    provider: "openai",
    apiKey: openAiKey,
    keyMode: "callback",
    prompt: "Reply with exactly: openai-ok",
  });
}

function writeResultFile(result) {
  if (!existsSync(resultDir)) {
    mkdirSync(resultDir, { recursive: true });
  }

  const outputPath = join(resultDir, `${runId}.json`);
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return outputPath;
}

function printSummary(result, outputPath) {
  console.log(`runId: ${runId}`);
  console.log(`result: ${outputPath}`);
  console.log(`openaiApiKey.ok: ${Boolean(result.tests.openaiApiKey?.ok)}`);
  console.log(`anthropicClaudeSetupToken.ok: ${Boolean(result.tests.anthropicClaudeSetupToken?.ok)}`);
  console.log(`openaiCodexOAuth.supportedInPiMono: ${Boolean(result.tests.openaiCodexOAuth?.supportedInPiMono)}`);
  console.log(`openaiCodexOAuth.skipped: ${Boolean(result.tests.openaiCodexOAuth?.skipped)}`);
}

async function main() {
  const oauthProviders = getOAuthProviders();
  const oauthProviderIds = oauthProviders.map((provider) => provider.id);

  const result = {
    runId,
    executedAt: new Date().toISOString(),
    envFile: envPath,
    providerInventory: buildProviderInventory({
      providers: getProviders(),
      oauthProviderIds,
      getModelsForProvider: getModels,
    }),
    oauthProviders: oauthProviders.map((provider) => ({ id: provider.id, name: provider.name })),
    tests: {
      openaiApiKey: null,
      anthropicClaudeSetupToken: null,
      openaiCodexOAuth: null,
    },
  };

  result.tests.openaiApiKey = await runOpenAiApiKeySmoke(process.env.OPENAI_API_KEY);
  result.tests.anthropicClaudeSetupToken = await runAnthropicClaudeSetupSmoke(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  result.tests.openaiCodexOAuth = await maybeRunCodexWithStoredOAuth(oauthProviderIds);

  const outputPath = writeResultFile(result);
  printSummary(result, outputPath);
}

await main();
