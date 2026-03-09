import * as path from "node:path";

import type { Context, Hono } from "hono";

import type { FileEntry, Sandbox } from "../sandbox/types.js";
import { toContentType, type FileTreeNode, WORKSPACE_ROOT } from "./file-routes.js";

const SHELL_UNSAFE_CHARS = /["$`\\!;|&<>(){}[\]#~*?\n\r\0]/;

function assertShellSafePath(filePath: string): void {
  if (SHELL_UNSAFE_CHARS.test(filePath)) {
    throw new Error("Path contains characters unsafe for shell execution.");
  }
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".css", ".csv", ".env", ".go", ".h", ".hpp",
  ".html", ".ini", ".java", ".js", ".json", ".log", ".md", ".mjs",
  ".py", ".rb", ".rs", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt",
  ".xml", ".yaml", ".yml",
]);
const TEXT_FILE_NAMES = new Set([
  ".dockerignore", ".gitignore", ".npmrc", "dockerfile", "license", "makefile", "readme",
]);
const UNSUPPORTED_PREVIEW_EXTENSIONS = new Set([
  ".7z", ".avi", ".bin", ".doc", ".docx", ".gz", ".mov", ".mp3",
  ".mp4", ".ppt", ".pptx", ".tar", ".wav", ".xls", ".xlsx", ".zip",
]);

const TEXT_PREVIEW_MAX_BYTES = 100 * 1024;

type PreviewType = "image" | "pdf" | "text" | "unsupported";

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

async function handleSandboxFileContent(c: Context, sandbox: Sandbox): Promise<Response> {
  const reqPath = c.req.path.replace("/api/sandbox-file-content", "");
  const resolved = path.normalize(reqPath);

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
      assertShellSafePath(resolved);
      const result = await sandbox.exec(`test -f "${resolved}"`);
      if (result.exitCode !== 0) {
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
    const truncated = text.length > TEXT_PREVIEW_MAX_BYTES;
    const preview = truncated ? text.slice(0, TEXT_PREVIEW_MAX_BYTES) : text;
    return c.json({ type: "text", ext, content: preview, truncated });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
}

async function handleSandboxFileDownload(c: Context, sandbox: Sandbox): Promise<Response> {
  const filePath = c.req.query("path") ?? "";
  if (!filePath) return c.json({ error: "Missing path" }, 400);
  const resolved = path.normalize(filePath);
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

export function registerSandboxFileRoutes(app: Hono, sandbox: Sandbox): void {
  app.get("/api/sandbox-files", async (c): Promise<Response> => {
    const rootPath = path.normalize(c.req.query("path") ?? "/");
    const maxDepth = rootPath.startsWith(WORKSPACE_ROOT) ? 10 : 3;
    try {
      const entries = await buildFileTree(sandbox, rootPath, maxDepth);
      return c.json({ entries, root: rootPath });
    } catch {
      return c.json({ entries: [], root: rootPath });
    }
  });
  app.get("/api/sandbox-file-content/*", (c) => handleSandboxFileContent(c, sandbox));
  app.get("/api/sandbox-file-download", (c) => handleSandboxFileDownload(c, sandbox));
}
