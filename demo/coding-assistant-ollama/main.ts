import { CodingAssistantOllama as factory } from "@agent-bundle/coding-assistant-ollama";
import { serveTUI } from "agent-bundle/tui";

const instance = await factory.init({ variables: {} as Record<never, string> });

await serveTUI(instance);
