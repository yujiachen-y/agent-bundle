import { vi } from "vitest";

export const getModelMock = vi.fn();
export const getModelsMock = vi.fn();
export const getProvidersMock = vi.fn();

type AgentEventListener = (event: unknown) => void;

export const agentInstances: MockAgent[] = [];

export class MockAgent {
  public readonly setSystemPrompt = vi.fn((prompt: string) => {
    this.state.systemPrompt = prompt;
  });

  public readonly setTools = vi.fn((tools: unknown[]) => {
    this.state.tools = tools;
  });

  public readonly replaceMessages = vi.fn((messages: unknown[]) => {
    this.state.messages = [...messages];
  });

  public readonly reset = vi.fn(() => {
    this.state.messages = [];
    this.state.error = undefined;
  });

  public readonly continue = vi.fn(async () => undefined);
  public readonly waitForIdle = vi.fn(async () => undefined);
  public readonly abort = vi.fn(() => undefined);

  public readonly state: {
    systemPrompt: string;
    tools: unknown[];
    messages: unknown[];
    error?: string;
  } = {
      systemPrompt: "",
      tools: [],
      messages: [],
      error: undefined,
    };

  private listeners: AgentEventListener[] = [];

  public constructor(public readonly options: unknown) {
    agentInstances.push(this);
  }

  public subscribe(listener: AgentEventListener): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    };
  }

  public emit(event: unknown): void {
    this.listeners.forEach((listener) => {
      listener(event);
    });
  }
}

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: MockAgent,
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: getModelMock,
  getModels: getModelsMock,
  getProviders: getProvidersMock,
}));

export async function importPiMonoLoop(): Promise<typeof import("./pi-mono-loop.js")> {
  return await import("./pi-mono-loop.js");
}

export function resetPiMocks(): void {
  agentInstances.length = 0;
  getProvidersMock.mockReset();
  getModelsMock.mockReset();
  getModelMock.mockReset();

  getProvidersMock.mockReturnValue(["openai", "google", "openrouter", "anthropic"]);
  getModelsMock.mockImplementation((provider: string) => {
    if (provider === "google") {
      return [{ id: "gemini-2.0-flash" }];
    }

    return [{ id: "gpt-5-mini" }];
  });
  getModelMock.mockImplementation((provider: string, model: string) => ({
    id: model,
    provider,
    api: provider === "google" ? "google-generative-ai" : "openai-responses",
  }));
}
