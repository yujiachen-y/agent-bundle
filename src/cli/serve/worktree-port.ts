import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

/**
 * FNV-1a 32-bit hash for deterministic port offset computation.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Detect if cwd is inside a Git worktree (not the main repo).
 * In a worktree the `.git` path is a file containing `gitdir: <path>`,
 * whereas in the main repo `.git` is a directory.
 * Returns the worktree directory basename, or null if not a worktree.
 */
function detectWorktreeName(cwd: string): string | null {
  const dotGitPath = resolve(cwd, ".git");

  try {
    const stat = statSync(dotGitPath);
    if (stat.isDirectory()) {
      return null; // main repo
    }
  } catch {
    return null; // no .git at all
  }

  try {
    const content = readFileSync(dotGitPath, "utf-8").trim();
    if (content.startsWith("gitdir:")) {
      return basename(cwd);
    }
  } catch {
    // ignore read errors
  }

  return null;
}

export type WorktreePortResult = {
  port: number;
  worktreeName: string;
};

/**
 * Resolve a deterministic port for the current worktree.
 * Returns null when not running inside a worktree.
 *
 * Port formula: basePort + (fnv1a(worktreeName) % 99 + 1) * 10
 * This yields offsets 10..990 in steps of 10, giving each worktree
 * a block of 10 ports (e.g. 3010-3019, 3140-3149).
 */
export function resolveWorktreePort(
  basePort: number,
  cwd: string = process.cwd(),
): WorktreePortResult | null {
  const name = detectWorktreeName(cwd);
  if (!name) {
    return null;
  }

  const offset = (fnv1a32(name) % 99 + 1) * 10;
  return { port: basePort + offset, worktreeName: name };
}
