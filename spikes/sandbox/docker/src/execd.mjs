import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ALLOWED_ROOTS = ['/skills', '/workspace'];
const DEFAULT_CWD = '/workspace';

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function isAllowedPath(candidate) {
  return ALLOWED_ROOTS.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`));
}

function resolveSandboxPath(inputPath, fallbackBase = DEFAULT_CWD) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new Error('path is required');
  }

  const resolved = path.resolve(inputPath.startsWith('/') ? inputPath : path.join(fallbackBase, inputPath));
  if (!isAllowedPath(resolved)) {
    throw new Error(`path outside sandbox roots: ${inputPath}`);
  }

  return resolved;
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON body');
  }
}

function runCommand(cmd, cwd) {
  return new Promise((resolve) => {
    execFile(
      '/bin/sh',
      ['-c', cmd],
      {
        cwd,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }

        const exitCode = typeof error.code === 'number' ? error.code : 1;
        resolve({ stdout, stderr: `${stderr}${error.killed ? '\n[killed by timeout]' : ''}`, exitCode });
      },
    );
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/command/run') {
      const body = await parseJsonBody(req);
      if (typeof body.cmd !== 'string' || body.cmd.trim() === '') {
        sendJson(res, 400, { error: 'cmd is required' });
        return;
      }

      const cwd = body.cwd ? resolveSandboxPath(body.cwd, DEFAULT_CWD) : DEFAULT_CWD;
      const result = await runCommand(body.cmd, cwd);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/files/write') {
      const body = await parseJsonBody(req);
      if (typeof body.content !== 'string') {
        sendJson(res, 400, { error: 'content must be a string' });
        return;
      }

      const targetPath = resolveSandboxPath(body.path, DEFAULT_CWD);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, body.content, 'utf8');
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/files/read') {
      const body = await parseJsonBody(req);
      const targetPath = resolveSandboxPath(body.path, DEFAULT_CWD);
      try {
        const content = await fs.readFile(targetPath, 'utf8');
        sendJson(res, 200, { content });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          sendJson(res, 404, { error: 'file not found' });
          return;
        }

        throw error;
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/files/list') {
      const queryPath = url.searchParams.get('path') || DEFAULT_CWD;
      const targetPath = resolveSandboxPath(queryPath, DEFAULT_CWD);
      const entries = await fs.readdir(targetPath);
      entries.sort((a, b) => a.localeCompare(b));
      sendJson(res, 200, { entries });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'bad request' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`execd listening on :${PORT}`);
});
