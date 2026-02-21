import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { KubeConfig, CoreV1Api, V1Pod } from '@kubernetes/client-node';
import YAML from 'yaml';

export type LifecycleMarks = {
  t0CreateRequested: number;
  t1Scheduled?: number;
  t2Running?: number;
  t3Ready?: number;
  t4HealthOk?: number;
  t5FirstCommand?: number;
};

export type SandboxHandles = {
  coreApi: CoreV1Api;
  namespace: string;
};

export function nowMs(): number {
  return Date.now();
}

export function formatDuration(startMs: number, endMs?: number): string {
  if (!endMs) {
    return 'n/a';
  }

  return `${endMs - startMs}ms`;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

export async function loadPodTemplate(templatePath: string): Promise<V1Pod> {
  const raw = await fs.readFile(templatePath, 'utf8');
  const parsed = YAML.parse(raw) as V1Pod;
  return parsed;
}

export function createKubeClients(namespace = 'default'): SandboxHandles {
  const kc = new KubeConfig();
  kc.loadFromDefault();
  return {
    coreApi: kc.makeApiClient(CoreV1Api),
    namespace,
  };
}

export function withTemplateValues(
  template: V1Pod,
  values: { podName: string; sessionId: string; image: string },
): V1Pod {
  const cloned = JSON.parse(JSON.stringify(template)) as V1Pod;
  cloned.metadata = cloned.metadata || {};
  cloned.metadata.name = values.podName;
  cloned.metadata.labels = {
    ...(cloned.metadata.labels || {}),
    'session-id': values.sessionId,
    app: 'agent-sandbox',
  };

  if (!cloned.spec || !cloned.spec.containers || cloned.spec.containers.length === 0) {
    throw new Error('pod template missing spec.containers');
  }

  cloned.spec.containers[0].image = values.image;
  return cloned;
}

export async function createPod(handles: SandboxHandles, pod: V1Pod): Promise<void> {
  await handles.coreApi.createNamespacedPod({
    namespace: handles.namespace,
    body: pod,
  });
}

export async function readPod(handles: SandboxHandles, podName: string): Promise<V1Pod | null> {
  try {
    const response = await handles.coreApi.readNamespacedPod({
      namespace: handles.namespace,
      name: podName,
    });
    return response;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export async function waitForPodReady(
  handles: SandboxHandles,
  podName: string,
  marks: LifecycleMarks,
  timeoutMs = 120_000,
): Promise<void> {
  const start = nowMs();

  for (;;) {
    const pod = await readPod(handles, podName);
    if (!pod) {
      throw new Error(`pod ${podName} not found while waiting for readiness`);
    }

    const conditions = pod.status?.conditions || [];

    const scheduled = conditions.find((c) => c.type === 'PodScheduled' && c.status === 'True');
    if (scheduled && !marks.t1Scheduled) {
      marks.t1Scheduled = nowMs();
    }

    if (pod.status?.phase === 'Running' && !marks.t2Running) {
      marks.t2Running = nowMs();
    }

    const ready = conditions.find((c) => c.type === 'Ready' && c.status === 'True');
    if (ready && !marks.t3Ready) {
      marks.t3Ready = nowMs();
      return;
    }

    if (pod.status?.phase === 'Failed') {
      throw new Error(`pod ${podName} entered Failed phase`);
    }

    if (nowMs() - start > timeoutMs) {
      throw new Error(`timeout waiting for pod ${podName} to become ready`);
    }

    await sleep(500);
  }
}

export async function deletePod(handles: SandboxHandles, podName: string): Promise<void> {
  try {
    await handles.coreApi.deleteNamespacedPod({
      namespace: handles.namespace,
      name: podName,
    });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

export async function forceDeletePod(handles: SandboxHandles, podName: string): Promise<void> {
  try {
    await handles.coreApi.deleteNamespacedPod({
      namespace: handles.namespace,
      name: podName,
      body: {
        gracePeriodSeconds: 0,
      },
    });
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

export async function waitForPodDeleted(
  handles: SandboxHandles,
  podName: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = nowMs();
  for (;;) {
    const pod = await readPod(handles, podName);
    if (!pod) {
      return;
    }

    if (nowMs() - start > timeoutMs) {
      throw new Error(`timeout waiting for pod ${podName} deletion`);
    }

    await sleep(500);
  }
}

export async function cleanupAgentSandboxPods(namespace = 'default'): Promise<string> {
  const args = ['delete', 'pods', '-n', namespace, '-l', 'app=agent-sandbox', '--ignore-not-found=true'];
  return await runCommand('kubectl', args);
}

export async function findFreePort(start = 31000, end = 60000): Promise<number> {
  for (let port = start; port <= end; port += 1) {
    const canUse = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });

    if (canUse) {
      return port;
    }
  }

  throw new Error('no free port found');
}

export async function startPortForward(
  podName: string,
  localPort: number,
  namespace = 'default',
): Promise<{ stop: () => Promise<void> }> {
  const child = spawn('kubectl', ['port-forward', '-n', namespace, `pod/${podName}`, `${localPort}:3000`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let started = false;
  let output = '';

  const startup = new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      output += text;
      if (text.includes('Forwarding from')) {
        started = true;
        resolve();
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.once('exit', (code) => {
      if (!started) {
        reject(
          new Error(
            `port-forward exited before startup (code=${String(code)}) for pod=${podName} localPort=${String(localPort)} output=${output.trim()}`,
          ),
        );
      }
    });
  });

  await Promise.race([
    startup,
    sleep(10_000).then(() => {
      throw new Error('timeout starting kubectl port-forward');
    }),
  ]);

  return {
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(resolve, 2_000);
      });
    },
  };
}

export async function waitForHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const start = nowMs();
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    if (nowMs() - start > timeoutMs) {
      throw new Error(`timeout waiting for health at ${baseUrl}`);
    }

    await sleep(300);
  }
}

export async function callJson<T>(baseUrl: string, method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${route}: ${text}`);
  }

  return payload;
}

export async function runCommand(bin: string, args: string[], cwd?: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));

    child.once('exit', (code) => {
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code === 0) {
        resolve(out.trim());
      } else {
        reject(new Error(`${bin} ${args.join(' ')} failed with code ${String(code)}\n${out}\n${err}`));
      }
    });
  });
}

export async function ensureDirectory(targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

export async function saveArtifact(filePath: string, content: string): Promise<void> {
  await ensureDirectory(filePath);
  await fs.writeFile(filePath, content, 'utf8');
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const responseStatusCode = (error as { response?: { statusCode?: number } }).response?.statusCode;
  const directCode = (error as { code?: number }).code;
  const statusCode = (error as { statusCode?: number }).statusCode;
  return responseStatusCode === 404 || directCode === 404 || statusCode === 404;
}
