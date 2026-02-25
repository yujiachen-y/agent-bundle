import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveWorktreePort } from "./worktree-port.js";

describe("resolveWorktreePort", () => {
  const tempDirs: string[] = [];

  function makeTempDir(name: string): string {
    const parent = mkdtempSync(join(tmpdir(), "wt-port-test-"));
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
  });

  it("returns null when .git is a directory (main repo)", () => {
    const dir = makeTempDir("main-repo");
    mkdirSync(join(dir, ".git"));
    expect(resolveWorktreePort(3000, dir)).toBeNull();
  });

  it("returns null when .git does not exist", () => {
    const dir = makeTempDir("no-git");
    expect(resolveWorktreePort(3000, dir)).toBeNull();
  });

  it("returns a port when .git is a worktree file", () => {
    const dir = makeTempDir("my-worktree");
    writeFileSync(join(dir, ".git"), "gitdir: /some/repo/.git/worktrees/my-worktree\n");

    const result = resolveWorktreePort(3000, dir);
    expect(result).not.toBeNull();
    expect(result!.worktreeName).toBe("my-worktree");
    expect(result!.port).toBeGreaterThan(3000);
    expect(result!.port).toBeLessThanOrEqual(3990);
    expect((result!.port - 3000) % 10).toBe(0);
  });

  it("returns deterministic port for the same directory name", () => {
    const dir1 = makeTempDir("stable-name");
    writeFileSync(join(dir1, ".git"), "gitdir: /repo/.git/worktrees/stable-name\n");

    const dir2 = makeTempDir("stable-name");
    writeFileSync(join(dir2, ".git"), "gitdir: /other/.git/worktrees/stable-name\n");

    const result1 = resolveWorktreePort(3000, dir1);
    const result2 = resolveWorktreePort(3000, dir2);
    expect(result1!.port).toBe(result2!.port);
  });

  it("returns different ports for different directory names", () => {
    const dir1 = makeTempDir("worktree-alpha");
    writeFileSync(join(dir1, ".git"), "gitdir: /repo/.git/worktrees/worktree-alpha\n");

    const dir2 = makeTempDir("worktree-beta");
    writeFileSync(join(dir2, ".git"), "gitdir: /repo/.git/worktrees/worktree-beta\n");

    const result1 = resolveWorktreePort(3000, dir1);
    const result2 = resolveWorktreePort(3000, dir2);
    expect(result1!.port).not.toBe(result2!.port);
  });

  it("respects the base port parameter", () => {
    const dir = makeTempDir("offset-test");
    writeFileSync(join(dir, ".git"), "gitdir: /repo/.git/worktrees/offset-test\n");

    const at3000 = resolveWorktreePort(3000, dir)!;
    const at4000 = resolveWorktreePort(4000, dir)!;
    expect(at4000.port - at3000.port).toBe(1000);
  });
});
