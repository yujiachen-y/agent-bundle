import { createServer as createNetServer } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isPortAvailable, resolveServicePort } from "./worktree-port.js";

// ── isPortAvailable ──────────────────────────────────────────────

describe("isPortAvailable", () => {
  it("returns true for an unused port", async () => {
    // Bind to :0 to get a free port, close it, then check availability.
    const server = createNetServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const freePort = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(await isPortAvailable(freePort)).toBe(true);
  });

  it("returns false for an occupied port", async () => {
    const server = createNetServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const occupiedPort = (server.address() as { port: number }).port;

    try {
      expect(await isPortAvailable(occupiedPort)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ── resolveServicePort ───────────────────────────────────────────

describe("resolveServicePort", () => {
  const tempDirs: string[] = [];
  const savedPort = process.env.PORT;

  function makeTempDir(name: string): string {
    const parent = mkdtempSync(join(tmpdir(), "svc-port-test-"));
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(parent);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;

    if (savedPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = savedPort;
    }
  });

  it("respects PORT environment variable", async () => {
    process.env.PORT = "5000";
    const port = await resolveServicePort(1);
    expect(port).toBe(5000);
  });

  it("returns defaultPrefix * 1000 + suffix for main repo", async () => {
    delete process.env.PORT;
    const dir = makeTempDir("main-repo");
    mkdirSync(join(dir, ".git"));

    const port = await resolveServicePort(2, { cwd: dir });
    expect(port).toBe(3002);
  });

  it("supports custom defaultPrefix", async () => {
    delete process.env.PORT;
    const dir = makeTempDir("main-custom");
    mkdirSync(join(dir, ".git"));

    const port = await resolveServicePort(5, { defaultPrefix: 4, cwd: dir });
    expect(port).toBe(4005);
  });

  it("returns prefix * 1000 + suffix for worktree", async () => {
    delete process.env.PORT;
    const dir = makeTempDir("my-worktree");
    writeFileSync(join(dir, ".git"), "gitdir: /repo/.git/worktrees/my-worktree\n");

    const port = await resolveServicePort(1, { cwd: dir });
    expect(port % 1000).toBe(1);
    expect(port).toBeGreaterThanOrEqual(10_000);
    expect(port).toBeLessThanOrEqual(63_999);
  });

  it("is deterministic for same worktree name and suffix", async () => {
    delete process.env.PORT;
    const dir1 = makeTempDir("deterministic-wt");
    writeFileSync(join(dir1, ".git"), "gitdir: /a/.git/worktrees/deterministic-wt\n");

    const dir2 = makeTempDir("deterministic-wt");
    writeFileSync(join(dir2, ".git"), "gitdir: /b/.git/worktrees/deterministic-wt\n");

    const port1 = await resolveServicePort(3, { cwd: dir1 });
    const port2 = await resolveServicePort(3, { cwd: dir2 });
    expect(port1).toBe(port2);
  });

  it("preserves suffix when preferred port is occupied (main repo)", async () => {
    delete process.env.PORT;
    const dir = makeTempDir("collision-main");
    mkdirSync(join(dir, ".git"));

    // Use a high prefix so we don't collide with real services.
    const testPrefix = 58;
    const suffix = 7;
    const preferredPort = testPrefix * 1000 + suffix; // 58007

    const server = createNetServer();
    await new Promise<void>((resolve) => server.listen(preferredPort, "127.0.0.1", () => resolve()));

    try {
      const port = await resolveServicePort(suffix, { defaultPrefix: testPrefix, cwd: dir });
      expect(port % 1000).toBe(suffix);
      expect(port).not.toBe(preferredPort);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
