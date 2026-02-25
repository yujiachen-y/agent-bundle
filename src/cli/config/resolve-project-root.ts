import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export async function resolveProjectRoot(startDir: string): Promise<string> {
  let current = resolve(startDir);

  while (true) {
    try {
      await access(join(current, "package.json"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return resolve(startDir);
      }

      current = parent;
    }
  }
}
