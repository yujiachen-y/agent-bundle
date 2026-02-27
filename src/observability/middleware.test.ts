import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createObservabilityProvider } from "./provider.js";
import { observabilityMiddleware } from "./middleware.js";

function createTestApp(): Hono {
  const provider = createObservabilityProvider();
  const app = new Hono();

  app.use("*", observabilityMiddleware(provider));

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.post("/v1/responses", (c) => c.json({ output: "hello" }));

  return app;
}

describe("observabilityMiddleware", () => {
  it("passes through GET requests without altering the response", async () => {
    const app = createTestApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("passes through POST requests without altering the response", async () => {
    const app = createTestApp();
    const response = await app.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "test" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ output: "hello" });
  });

  it("preserves 404 for unknown routes", async () => {
    const app = createTestApp();
    const response = await app.request("/unknown");

    expect(response.status).toBe(404);
  });

  it("handles handler errors gracefully", async () => {
    const provider = createObservabilityProvider();
    const app = new Hono();

    app.use("*", observabilityMiddleware(provider));
    app.get("/error", () => {
      throw new Error("handler failed");
    });

    const response = await app.request("/error");
    // Hono turns unhandled throws into 500
    expect(response.status).toBe(500);
  });
});
