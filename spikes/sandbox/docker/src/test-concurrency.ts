import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callJson,
  createKubeClients,
  createPod,
  deletePod,
  findFreePort,
  loadPodTemplate,
  nowMs,
  startPortForward,
  waitForHealth,
  waitForPodDeleted,
  waitForPodReady,
  withTemplateValues,
} from './lib/sandbox.js';

type CommandResponse = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type ReadFileResponse = {
  content: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSingle(index: number, skillMd: string, processPy: string): Promise<void> {
  const namespace = 'default';
  const handles = createKubeClients(namespace);
  const templatePath = path.resolve(__dirname, '..', 'sandbox-pod.yaml');
  const template = await loadPodTemplate(templatePath);

  const sessionId = `conc-${index}-${Date.now().toString(36)}`;
  const podName = `sandbox-${sessionId}`;

  const pod = withTemplateValues(template, {
    podName,
    sessionId,
    image: 'sandbox:spike',
  });

  let stopPortForward: (() => Promise<void>) | null = null;

  try {
    await createPod(handles, pod);
    await waitForPodReady(handles, podName, { t0CreateRequested: nowMs() });

    const preferredPort = 38000 + index;
    let port = preferredPort;
    let pf;
    try {
      pf = await startPortForward(podName, port, namespace);
    } catch {
      port = await findFreePort(38100 + index * 20, 38119 + index * 20);
      pf = await startPortForward(podName, port, namespace);
    }

    stopPortForward = pf.stop;

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl);

    await callJson<{ ok: true }>(baseUrl, 'POST', '/files/write', {
      path: '/skills/SKILL.md',
      content: `${skillMd}\n\nSession: ${sessionId}\n`,
    });

    await callJson<{ ok: true }>(baseUrl, 'POST', '/files/write', {
      path: '/skills/process.py',
      content: processPy,
    });

    const runResult = await callJson<CommandResponse>(baseUrl, 'POST', '/command/run', {
      cmd: 'python3 /skills/process.py',
    });

    if (runResult.exitCode !== 0) {
      throw new Error(`session ${sessionId} failed to execute process.py`);
    }

    const output = await callJson<ReadFileResponse>(baseUrl, 'POST', '/files/read', {
      path: '/workspace/result.txt',
    });

    if (!output.content.includes('processed-by-python')) {
      throw new Error(`session ${sessionId} result validation failed`);
    }
  } finally {
    if (stopPortForward) {
      await stopPortForward();
    }

    await deletePod(handles, podName);
    await waitForPodDeleted(handles, podName).catch(() => {
      // best-effort cleanup
    });
  }
}

async function run(): Promise<void> {
  const skillPath = path.resolve(__dirname, '..', 'test-skill', 'SKILL.md');
  const scriptPath = path.resolve(__dirname, '..', 'test-skill', 'process.py');
  const skillMd = await fs.readFile(skillPath, 'utf8');
  const processPy = await fs.readFile(scriptPath, 'utf8');

  const start = nowMs();
  const tasks: Promise<void>[] = [];

  for (let i = 1; i <= 5; i += 1) {
    tasks.push(runSingle(i, skillMd, processPy));
  }

  const results = await Promise.allSettled(tasks);
  const end = nowMs();

  const failures = results.filter((result) => result.status === 'rejected');

  console.log(`Concurrency wall time: ${end - start}ms`);
  console.log(`Total sessions: ${results.length}, failures: ${failures.length}`);

  if (failures.length > 0) {
    for (const failure of failures) {
      if (failure.status === 'rejected') {
        console.error(failure.reason);
      }
    }
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
