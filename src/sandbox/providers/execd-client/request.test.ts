import { beforeEach, describe, expect, it, vi } from "vitest";

import { findFreePort, requestJson, waitForHealth } from "./request.js";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("requestJson", () => {
  it("returns parsed json payload for successful responses", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    const response = await requestJson<{ ok: boolean }>("http://sandbox/files/read", {
      method: "POST",
      body: "{}",
    });

    expect(response).toEqual({ ok: true });
  });

  it("returns empty object for successful empty response bodies", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    const response = await requestJson<Record<string, never>>("http://sandbox/files/write", {
      method: "POST",
      body: "{}",
    });

    expect(response).toEqual({});
  });

  it("throws with status and body for non-OK responses", async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"denied"}', { status: 403 }));

    await expect(
      requestJson("http://sandbox/files/delete", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrowError(/HTTP 403/);
  });
});

describe("waitForHealth", () => {
  it("retries until /health returns OK", async () => {
    let attempts = 0;
    fetchMock.mockImplementation(async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response('{"status":"starting"}', { status: 503 });
      }

      return new Response('{"status":"ok"}', { status: 200 });
    });

    await waitForHealth("http://sandbox", 1_000, 1);

    expect(attempts).toBe(3);
  });

  it("times out when /health never becomes ready", async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"down"}', { status: 503 }));

    await expect(waitForHealth("http://sandbox", 5, 1)).rejects.toThrowError(
      "Timed out waiting for execd health",
    );
  });
});

describe("findFreePort", () => {
  it("returns a positive local TCP port", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
  });
});
