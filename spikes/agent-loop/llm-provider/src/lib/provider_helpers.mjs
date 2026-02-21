export const ENV_VAR_HINTS = {
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

const PREFERRED_MODELS = {
  openai: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1"],
  anthropic: ["claude-sonnet-4-5", "claude-sonnet-4", "claude-3-7-sonnet"],
  "openai-codex": ["gpt-5.3-codex", "gpt-5.2-codex"],
};

function pickPreferredModel(models, preferredCandidates) {
  const matches = preferredCandidates
    .map((candidate) => models.find((model) => model.id.includes(candidate)))
    .filter(Boolean);

  return matches[0] || null;
}

export function pickModelId(provider, models) {
  if (!models.length) {
    throw new Error(`No models found for provider: ${provider}`);
  }

  const preferredCandidates = PREFERRED_MODELS[provider] || [];
  const preferredModel = pickPreferredModel(models, preferredCandidates);

  if (preferredModel) {
    return preferredModel.id;
  }

  return models[0].id;
}

export function buildProviderInventory({ providers, oauthProviderIds, getModelsForProvider, envVarHints = ENV_VAR_HINTS }) {
  const oauthProviderSet = new Set(oauthProviderIds);

  return [...providers].sort().map((provider) => ({
    provider,
    modelCount: getModelsForProvider(provider).length,
    oauth: oauthProviderSet.has(provider),
    envOrCredentialHints: envVarHints[provider] || null,
  }));
}
