import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export const EXECD_PORT = 3000;

export async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}: ${bodyText}`);
  }

  const payload = bodyText.length > 0 ? JSON.parse(bodyText) : {};
  return payload as T;
}

export async function waitForHealth(
  baseUrl: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for execd health at ${baseUrl}.`);
    }

    await sleep(intervalMs);
  }
}

export async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to acquire a local port for execd connection."));
        });
        return;
      }

      const selectedPort = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(selectedPort);
      });
    });
  });
}
