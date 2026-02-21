export function assertApiKey(envPath: string): void {
  if (process.env.E2B_API_KEY) {
    return;
  }

  throw new Error(`Missing E2B_API_KEY. Expected in ${envPath}`);
}
