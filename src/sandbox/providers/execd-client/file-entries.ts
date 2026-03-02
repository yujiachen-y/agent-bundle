import type { FileEntry } from "../../types.js";

import type { FileListResponse } from "./types.js";

export function toFileEntries(basePath: string, payload: FileListResponse): FileEntry[] {
  return payload.entries.map((entry) => {
    if (typeof entry === "string") {
      return {
        name: entry,
        path: `${basePath.replace(/\/$/, "")}/${entry}`,
        type: "file",
      };
    }

    const name = entry.name ?? entry.path ?? "unknown";
    const type = entry.type === "directory" || entry.type === "dir" ? "directory" : "file";
    return {
      name,
      path: entry.path ?? `${basePath.replace(/\/$/, "")}/${name}`,
      type,
    };
  });
}
