export function quoteShellArg(input: string): string {
  return `'${input.replaceAll("'", `'\"'\"'`)}'`;
}
