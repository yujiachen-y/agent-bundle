export function getAssistantText(message) {
  if (!message || message.role !== "assistant") {
    return "";
  }

  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("")
    .trim();
}

export function hasTokenCounting(usage) {
  return Boolean(
    usage
      && Number.isFinite(usage.input)
      && Number.isFinite(usage.output)
      && Number.isFinite(usage.totalTokens)
      && usage.totalTokens > 0,
  );
}

export function buildOAuthCredentialMap(auth) {
  if (!auth || typeof auth !== "object") {
    return {};
  }

  const entries = Object.entries(auth)
    .filter(([, value]) => value && typeof value === "object" && value.type === "oauth")
    .map(([provider, value]) => {
      const credentials = { ...value };
      delete credentials.type;
      return [provider, credentials];
    });

  return Object.fromEntries(entries);
}

export function buildSkippedTestResult(reason) {
  return {
    ok: false,
    skipped: true,
    reason,
  };
}

export async function withTemporaryEnvVar(key, value, callback) {
  const originalValue = process.env[key];

  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
}
