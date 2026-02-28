import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
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
 * Walks up parent directories to find the nearest `.git` entry.
 * In a worktree the `.git` path is a file containing `gitdir: <path>`,
 * whereas in the main repo `.git` is a directory.
 * Returns the worktree root directory basename, or null if not a worktree.
 */
function detectWorktreeName(cwd: string): string | null {
  let dir = resolve(cwd);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const dotGitPath = resolve(dir, ".git");

    try {
      const stat = statSync(dotGitPath);
      if (stat.isDirectory()) {
        return null; // main repo root
      }
      // .git is a file — check if it's a worktree pointer
      const content = readFileSync(dotGitPath, "utf-8").trim();
      if (content.startsWith("gitdir:")) {
        return basename(dir);
      }
      return null;
    } catch {
      // no .git here, try parent
    }

    const parent = resolve(dir, "..");
    if (parent === dir) {
      return null; // reached filesystem root
    }
    dir = parent;
  }
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
 *
 * @deprecated Use {@link resolveServicePort} for new code.
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

// ── Service port allocation (prefix × 1000 + suffix) ────────────

const MIN_WORKTREE_PREFIX = 10;
const PREFIX_COUNT = 54; // prefixes 10–63

/**
 * Check whether a TCP port is available on localhost.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Compute a service port: `prefix × 1000 + suffix`.
 *
 * - **suffix** (last three digits): stable service identity
 *   (0 = serve/dev, 1 = code-formatter/e2b, 2 = code-formatter/k8s, 3 = financial-plugin, 5 = personalized-recommend, 6 = observability-demo, …).
 * - **prefix**: `defaultPrefix` (3) for the main repo,
 *   hash-based 10–63 for worktrees.
 *
 * Priority:
 * 1. `PORT` env var → returned directly.
 * 2. Auto-computed `prefix × 1000 + suffix`, with collision
 *    fallback that rotates the prefix (never the suffix).
 */
export async function resolveServicePort(
  suffix: number,
  options?: { defaultPrefix?: number; cwd?: string },
): Promise<number> {
  const envPort = process.env.PORT;
  if (envPort !== undefined && envPort !== "") {
    return Number(envPort);
  }

  const defaultPrefix = options?.defaultPrefix ?? 3;
  const cwd = options?.cwd ?? process.cwd();
  const worktreeName = detectWorktreeName(cwd);

  if (!worktreeName) {
    const preferred = defaultPrefix * 1000 + suffix;
    if (await isPortAvailable(preferred)) return preferred;
    for (let i = 0; i < PREFIX_COUNT; i++) {
      const candidate = (MIN_WORKTREE_PREFIX + i) * 1000 + suffix;
      if (await isPortAvailable(candidate)) return candidate;
    }
    throw new Error(`No available port found for suffix ${suffix}`);
  }

  const base = MIN_WORKTREE_PREFIX + (fnv1a32(worktreeName) % PREFIX_COUNT);
  for (let i = 0; i < PREFIX_COUNT; i++) {
    const p = MIN_WORKTREE_PREFIX + ((base - MIN_WORKTREE_PREFIX + i) % PREFIX_COUNT);
    const candidate = p * 1000 + suffix;
    if (await isPortAvailable(candidate)) return candidate;
  }
  throw new Error(`No available port found for suffix ${suffix}`);
}
