const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g;

function collectRequiredVariables(template: string): string[] {
  const required = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    required.add(match[1]);
  }

  return [...required];
}

export function fillSystemPrompt(
  template: string,
  variables: Record<string, string>,
): string {
  const missingVariables = collectRequiredVariables(template).filter(
    (name) => !Object.hasOwn(variables, name),
  );

  if (missingVariables.length > 0) {
    const missingText = missingVariables.sort().join(", ");
    throw new Error(`Missing required prompt variables: ${missingText}`);
  }

  return template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    return variables[key];
  });
}
