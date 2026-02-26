import { CodingAssistantOllama as factory } from "../../../dist/coding-assistant-ollama/index.ts";
import { serveTUI } from "../../../src/tui/tui.js";

const instance = await factory.init({ variables: {} as Record<never, string> });

await serveTUI(instance);
