import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { type V1Pod } from '@kubernetes/client-node';
import { expect, it } from 'vitest';
import {
  callJson,
  ensureDirectory,
  formatDuration,
  percentile,
  runCommand,
  saveArtifact,
  withTemplateValues,
} from './sandbox.js';

function createTemplatePod(): V1Pod {
  return {
    metadata: {
      name: 'template',
      labels: {
        keep: 'true',
      },
    },
    spec: {
      containers: [
        {
          name: 'execd',
          image: 'before:image',
        },
      ],
    },
  };
}

async function startTestServer(
  handler: http.RequestListener,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve server address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

it('formatDuration formats elapsed milliseconds', () => {
  expect(formatDuration(10, 55)).toBe('45ms');
  expect(formatDuration(10)).toBe('n/a');
});

it('percentile returns expected rank values', () => {
  expect(percentile([], 50)).toBe(0);
  expect(percentile([100, 10, 50], 50)).toBe(50);
  expect(percentile([1, 2, 3, 4], 90)).toBe(4);
});

it('withTemplateValues clones template and injects runtime values', () => {
  const template = createTemplatePod();
  const updated = withTemplateValues(template, {
    podName: 'sandbox-sess-x',
    sessionId: 'sess-x',
    image: 'sandbox:spike',
  });

  expect(updated.metadata?.name).toBe('sandbox-sess-x');
  expect(updated.metadata?.labels?.['session-id']).toBe('sess-x');
  expect(updated.metadata?.labels?.app).toBe('agent-sandbox');
  expect(updated.metadata?.labels?.keep).toBe('true');
  expect(updated.spec?.containers?.[0]?.image).toBe('sandbox:spike');

  expect(template.metadata?.name).toBe('template');
  expect(template.spec?.containers?.[0]?.image).toBe('before:image');
});

it('saveArtifact writes file content after ensuring directory exists', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-test-'));
  const artifactPath = path.join(tempDir, 'nested', 'result.txt');

  try {
    await ensureDirectory(artifactPath);
    await saveArtifact(artifactPath, 'artifact-content');

    const saved = await fs.readFile(artifactPath, 'utf8');
    expect(saved).toBe('artifact-content');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

it('runCommand resolves output for success and rejects for non-zero exit', async () => {
  const out = await runCommand('node', ['-e', 'console.log("ok")']);
  expect(out).toBe('ok');

  await expect(runCommand('node', ['-e', 'process.exit(7)'])).rejects.toThrow(/failed with code 7/);
});

it('callJson sends and parses JSON payloads', async () => {
  const server = await startTestServer(async (req, res) => {
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) {
      bodyChunks.push(Buffer.from(chunk));
    }

    const parsed = JSON.parse(Buffer.concat(bodyChunks).toString('utf8')) as { value: string };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ echoed: parsed.value, method: req.method }));
  });

  try {
    const payload = await callJson<{ echoed: string; method: string }>(
      server.baseUrl,
      'POST',
      '/echo',
      { value: 'hello' },
    );

    expect(payload).toEqual({ echoed: 'hello', method: 'POST' });
  } finally {
    await server.close();
  }
});

it('callJson throws with HTTP status details on non-OK response', async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing' }));
  });

  try {
    await expect(callJson(server.baseUrl, 'GET', '/missing')).rejects.toThrow(/HTTP 404 \/missing:/);
  } finally {
    await server.close();
  }
});
