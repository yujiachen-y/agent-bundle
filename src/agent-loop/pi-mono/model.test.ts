import { beforeEach, expect, it, vi } from "vitest";

const getModelsMock = vi.fn();
const getProvidersMock = vi.fn();

vi.mock("@mariozechner/pi-ai", () => ({
  getModels: getModelsMock,
  getProviders: getProvidersMock,
}));

const { resolveOllamaBaseUrl, resolvePiModel } = await import("./model.js");

beforeEach(() => {
  getProvidersMock.mockReset();
  getModelsMock.mockReset();
  getProvidersMock.mockReturnValue(["openai", "google", "openrouter", "anthropic"]);
  getModelsMock.mockImplementation(() => []);
});

function withTemporaryEnv(
  updates: Record<string, string | undefined>,
  callback: () => void,
): void {
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
    callback();
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

it("normalizes ollama base URL by trimming trailing slashes", () => {
  withTemporaryEnv(
    {
      OLLAMA_BASE_URL: "http://localhost:11434///",
      OLLAMA_HOST: undefined,
    },
    () => {
      expect(resolveOllamaBaseUrl()).toBe("http://localhost:11434/v1");
    },
  );
});

it("prefers OLLAMA_BASE_URL over OLLAMA_HOST when both are set", () => {
  withTemporaryEnv(
    {
      OLLAMA_BASE_URL: "http://base-url:11434",
      OLLAMA_HOST: "http://host-url:11434",
    },
    () => {
      expect(resolveOllamaBaseUrl()).toBe("http://base-url:11434/v1");
    },
  );
});

it("falls back to OLLAMA_HOST when OLLAMA_BASE_URL is not set", () => {
  withTemporaryEnv(
    {
      OLLAMA_BASE_URL: undefined,
      OLLAMA_HOST: "http://host-url:11434",
    },
    () => {
      expect(resolveOllamaBaseUrl()).toBe("http://host-url:11434/v1");
    },
  );
});

it("keeps openrouter provider mapping as passthrough", () => {
  const openRouterModel = {
    id: "openai/gpt-4o-mini",
    provider: "openrouter",
    api: "openai-completions",
  };
  getModelsMock.mockImplementation((provider: string) => {
    if (provider === "openrouter") {
      return [openRouterModel];
    }

    return [];
  });

  const resolved = resolvePiModel({
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
  });

  expect(getModelsMock).toHaveBeenCalledWith("openrouter");
  expect(resolved).toBe(openRouterModel);
});
