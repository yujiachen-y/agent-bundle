import * as path from "node:path";

import type { Context, Hono } from "hono";

import type { Agent } from "../agent/types.js";
import type { FileEntry, Sandbox } from "../sandbox/types.js";
import { isRecord } from "../shared/errors.js";
import type { WebUIEventBus } from "./event-bus.js";

export type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};

export const WORKSPACE_ROOT = "/workspace";

const CONTENT_TYPES: Record<string, string> = {
  ".c": "text/plain; charset=utf-8",
  ".cc": "text/plain; charset=utf-8",
  ".cpp": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".env": "text/plain; charset=utf-8",
  ".gif": "image/gif",
  ".go": "text/plain; charset=utf-8",
  ".h": "text/plain; charset=utf-8",
  ".hpp": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ini": "text/plain; charset=utf-8",
  ".java": "text/plain; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".py": "text/plain; charset=utf-8",
  ".rb": "text/plain; charset=utf-8",
  ".rs": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".toml": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".csv",
  ".env",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".log",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const TEXT_FILE_NAMES = new Set([".dockerignore", ".gitignore", ".npmrc", "dockerfile", "license", "makefile", "readme"]);
const UNSUPPORTED_PREVIEW_EXTENSIONS = new Set([
  ".7z", ".avi", ".bin", ".doc", ".docx", ".gz", ".mov", ".mp3",
  ".mp4", ".ppt", ".pptx", ".tar", ".wav", ".xls", ".xlsx", ".zip",
]);

type PreviewType = "image" | "pdf" | "text" | "unsupported";

/** Strict prefix check — prevents `/workspacevil` from passing. */
function isWithinWorkspace(resolved: string): boolean {
  return resolved === WORKSPACE_ROOT || resolved.startsWith(WORKSPACE_ROOT + "/");
}

/** Reject characters that can break double-quoted shell interpolation. */
const SHELL_UNSAFE_CHARS = /["$`\\!;|&<>(){}[\]#~*?\n\r\0]/;

function assertShellSafePath(filePath: string): void {
  if (SHELL_UNSAFE_CHARS.test(filePath)) {
    throw new Error("Path contains characters unsafe for shell execution.");
  }
}

export function toContentType(ext: string): string {
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function isTextPreviewPath(resolved: string, ext: string): boolean {
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const fileName = path.basename(resolved).toLowerCase();
  return fileName.startsWith(".env") || TEXT_FILE_NAMES.has(fileName);
}

function getPreviewType(resolved: string, ext: string): PreviewType {
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if (isTextPreviewPath(resolved, ext)) return "text";
  if (UNSUPPORTED_PREVIEW_EXTENSIONS.has(ext)) return "unsupported";
  return "unsupported";
}

async function fileExists(sandbox: Sandbox, resolved: string): Promise<boolean> {
  assertShellSafePath(resolved);
  const result = await sandbox.exec(`test -f "${resolved}"`);
  return result.exitCode === 0;
}

async function buildFileTree(
  sandbox: Sandbox,
  dirPath: string,
  maxDepth = 10,
): Promise<FileTreeNode[]> {
  if (maxDepth <= 0) return [];

  let entries: FileEntry[];
  try {
    entries = await sandbox.file.list(dirPath);
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];
  for (const entry of entries) {
    const node: FileTreeNode = {
      name: entry.name,
      path: entry.path,
      type: entry.type,
    };

    if (entry.type === "directory") {
      try {
        node.children = await buildFileTree(sandbox, entry.path, maxDepth - 1);
      } catch {
        node.children = [];
      }
    }

    nodes.push(node);
  }

  return nodes;
}

async function handleFileContent(c: Context, sandbox: Sandbox): Promise<Response> {
  const reqPath = c.req.path.replace("/api/file-content", "");
  const resolved = path.normalize(
    reqPath.startsWith(WORKSPACE_ROOT) ? reqPath : path.join(WORKSPACE_ROOT, reqPath),
  );

  if (!isWithinWorkspace(resolved)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const ext = path.extname(resolved).toLowerCase();
  const previewType = getPreviewType(resolved, ext);

  try {
    if (previewType === "image" || previewType === "pdf") {
      assertShellSafePath(resolved);
      const result = await sandbox.exec(`base64 < "${resolved}"`);
      if (result.exitCode !== 0) {
        return c.json({ error: "Not found" }, 404);
      }
      const base64 = result.stdout.replace(/\s/g, "");
      return c.json({ type: previewType, ext, base64 });
    }

    if (previewType === "unsupported") {
      const exists = await fileExists(sandbox, resolved);
      if (!exists) {
        return c.json({ error: "Not found" }, 404);
      }

      return c.json({
        type: "unsupported",
        ext,
        message: "Preview unavailable for this file type. Download to open locally.",
      });
    }

    const content = await sandbox.file.read(resolved);
    const text = typeof content === "string"
      ? content
      : new TextDecoder().decode(content as ArrayBuffer);
    return c.json({ type: "text", ext, content: text });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
}

async function handleFileUpload(c: Context, sandbox: Sandbox): Promise<Response> {
  try {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "No file provided" }, 400);
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) return c.json({ error: "File exceeds 10 MB limit" }, 413);
    const safeName = path.basename(file.name);
    const targetDir = typeof body.dir === "string" ? body.dir : WORKSPACE_ROOT;
    const resolved = path.normalize(path.join(targetDir, safeName));
    if (!isWithinWorkspace(resolved)) return c.json({ error: "Forbidden" }, 403);
    assertShellSafePath(resolved);

    const buf = Buffer.from(await file.arrayBuffer());
    const tmpPath = resolved + ".__upload_tmp";
    await sandbox.file.write(tmpPath, buf.toString("base64"));
    const res = await sandbox.exec(
      `base64 -d "${tmpPath}" > "${resolved}"; status=$?; rm -f "${tmpPath}"; exit $status`,
    );
    if (res.exitCode !== 0) return c.json({ error: "Write failed" }, 500);
    return c.json({ ok: true, path: resolved });
  } catch {
    return c.json({ error: "Upload failed" }, 500);
  }
}

async function handleFileDownload(c: Context, sandbox: Sandbox): Promise<Response> {
  const filePath = c.req.query("path") ?? "";
  if (!filePath) return c.json({ error: "Missing path" }, 400);
  const resolved = path.normalize(
    filePath.startsWith(WORKSPACE_ROOT) ? filePath : path.join(WORKSPACE_ROOT, filePath),
  );
  if (!isWithinWorkspace(resolved)) return c.json({ error: "Forbidden" }, 403);
  try {
    assertShellSafePath(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const fileName = path.basename(resolved);
    const result = await sandbox.exec(`base64 < "${resolved}"`);
    if (result.exitCode !== 0) return c.json({ error: "Not found" }, 404);
    const buf = Buffer.from(result.stdout.replace(/\s/g, ""), "base64");
    return new Response(buf, {
      headers: {
        "content-type": toContentType(ext),
        "content-disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch {
    return c.json({ error: "Download failed" }, 500);
  }
}

async function clearWorkspaceFiles(sandbox: Sandbox): Promise<void> {
  const result = await sandbox.exec(
    "find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +",
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to clear workspace files.");
  }
}

export async function clearContext(
  agent: Agent,
  sandbox: Sandbox,
  eventBus: WebUIEventBus,
  clearWorkspace: boolean,
): Promise<void> {
  agent.clearHistory();

  if (clearWorkspace) {
    await clearWorkspaceFiles(sandbox);
  }

  eventBus.emit({ type: "files_changed" });
}

async function handleClearContext(
  c: Context,
  agent: Agent,
  sandbox: Sandbox,
  eventBus: WebUIEventBus,
): Promise<Response> {
  let clearWorkspace = false;
  try {
    const body: unknown = await c.req.json();
    clearWorkspace = isRecord(body) && body.clearWorkspace === true;
  } catch {
    clearWorkspace = false;
  }

  try {
    await clearContext(agent, sandbox, eventBus, clearWorkspace);
    return c.json({ ok: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to clear context." },
      500,
    );
  }
}

export function registerFileRoutes(
  app: Hono,
  agent: Agent,
  sandbox: Sandbox,
  eventBus: WebUIEventBus,
): void {
  app.get("/api/files", async (c): Promise<Response> => {
    try {
      const entries = await buildFileTree(sandbox, WORKSPACE_ROOT);
      return c.json({ entries });
    } catch {
      return c.json({ entries: [] });
    }
  });
  app.get("/api/file-content/*", (c) => handleFileContent(c, sandbox));
  app.post("/api/file-upload", (c) => handleFileUpload(c, sandbox));
  app.get("/api/file-download", (c) => handleFileDownload(c, sandbox));
  app.post("/api/clear-context", (c) => handleClearContext(c, agent, sandbox, eventBus));
}
