import { Hono } from "hono";

import type { ResponseInput } from "../agent-loop/types.js";
import type { Agent } from "../agent/types.js";
import type { Command } from "../commands/types.js";

export type CommandSummary = {
  name: string;
  description: string;
  argumentHint?: string;
};

export type CommandRegistry = {
  commands: readonly Command[];
};

const ARGUMENTS_PLACEHOLDER = /\$ARGUMENTS/g;

export function substituteArguments(content: string, args: string): string {
  return content.replace(ARGUMENTS_PLACEHOLDER, args);
}

function toSummary(command: Command): CommandSummary {
  return {
    name: command.name,
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
  };
}

function findCommand(registry: CommandRegistry, name: string): Command | undefined {
  return registry.commands.find(
    (cmd) => cmd.name === name || cmd.name.toLowerCase() === name.toLowerCase(),
  );
}

export function createCommandRoutes(agent: Agent, registry: CommandRegistry): Hono {
  const routes = new Hono();

  routes.get("/commands", (c): Response => {
    const summaries = registry.commands.map(toSummary);
    return c.json(summaries);
  });

  routes.post("/commands/:name", async (c): Promise<Response> => {
    const name = c.req.param("name");
    const command = findCommand(registry, name);
    if (!command) {
      return c.json({ error: { message: `Command not found: ${name}` } }, 404);
    }

    let args = "";
    try {
      const body = await c.req.json<{ args?: string }>();
      args = typeof body.args === "string" ? body.args : "";
    } catch {
      // No body or invalid JSON — use empty args
    }

    const userMessage = substituteArguments(command.content, args);
    const input: ResponseInput = [{ role: "user", content: userMessage }];

    try {
      const output = await agent.respond(input);
      return c.json(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: { message } }, 500);
    }
  });

  return routes;
}
