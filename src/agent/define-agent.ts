import { createInitializedAgent } from "./agent.js";
import type { AgentConfig, AgentFactory } from "./types.js";

function validateRequiredVariables<V extends string>(
  expectedVariables: readonly V[],
  variables: Record<V, string>,
): void {
  const missingVariables = expectedVariables.filter((name) => !Object.hasOwn(variables, name));
  if (missingVariables.length === 0) {
    return;
  }

  throw new Error(`Missing required init variables: ${missingVariables.join(", ")}`);
}

export function defineAgent<V extends string>(config: AgentConfig<V>): AgentFactory<V> {
  return {
    name: config.name,
    init: async (options) => {
      validateRequiredVariables(config.variables, options.variables);
      return await createInitializedAgent(config, options);
    },
  };
}
