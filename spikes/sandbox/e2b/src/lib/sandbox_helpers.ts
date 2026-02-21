import { Sandbox, type SandboxInfo } from "e2b";

export async function safeKillSandbox(sandbox: Sandbox | null): Promise<void> {
  if (!sandbox) {
    return;
  }

  try {
    await sandbox.kill();
  } catch {
    // The sandbox may already be terminated; ignore cleanup failures.
  }
}

export async function findSandboxById(sandboxId: string): Promise<SandboxInfo | null> {
  const paginator = Sandbox.list({ limit: 100 });

  while (paginator.hasNext) {
    const items = await paginator.nextItems();
    const match = items.find((item) => item.sandboxId === sandboxId);
    if (match) {
      return match;
    }
  }

  return null;
}
