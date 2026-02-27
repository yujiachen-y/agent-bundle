import { CodingAssistantOllama as factory } from "@agent-bundle/coding-assistant-ollama";

const instance = await factory.init({ variables: {} as Record<never, string> });

console.log(`Agent "${instance.name}" is running. Press Ctrl+C to stop.`);
await new Promise<void>((resolve) => {
  process.on("SIGINT", () => resolve());
  process.on("SIGTERM", () => resolve());
});
await instance.shutdown();
