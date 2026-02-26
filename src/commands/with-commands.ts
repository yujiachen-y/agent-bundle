import type { Agent } from "../agent/types.js";
import type { ResponseInput, ResponseOutput } from "../agent-loop/types.js";

export type CommandDef = {
  methodName: string;
  content: string;
};

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "name", "status", "respond", "respondStream", "shutdown",
  "__proto__", "constructor", "toString", "hasOwnProperty", "valueOf",
]);

export function withCommands<T>(agent: Agent, commands: CommandDef[]): Agent & T {
  const extended = Object.create(agent) as Agent & Record<string, unknown>;

  commands.forEach((cmd) => {
    if (RESERVED_KEYS.has(cmd.methodName)) {
      throw new Error(
        `Command method name "${cmd.methodName}" conflicts with a reserved Agent property.`,
      );
    }

    extended[cmd.methodName] = async (args: string = ""): Promise<ResponseOutput> => {
      const content = cmd.content.replace(/\$ARGUMENTS/g, () => args);
      const input: ResponseInput = [{ role: "user", content }];
      return agent.respond(input);
    };
  });

  return extended as Agent & T;
}
