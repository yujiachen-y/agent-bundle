import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  callJson,
  createKubeClients,
  createPod,
  deletePod,
  findFreePort,
  forceDeletePod,
  loadPodTemplate,
  nowMs,
  saveArtifact,
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

async function run(): Promise<void> {
  const namespace = 'default';
  const handles = createKubeClients(namespace);
  const templatePath = path.resolve(__dirname, '..', 'sandbox-pod.yaml');
  const template = await loadPodTemplate(templatePath);
  const sessionId = `sess-${Date.now().toString(36)}`;
  const podName = `sandbox-${sessionId}`;

  const skillMdPath = path.resolve(__dirname, '..', 'test-skill', 'SKILL.md');
  const processPyPath = path.resolve(__dirname, '..', 'test-skill', 'process.py');
  const localSkill = await fs.readFile(skillMdPath, 'utf8');
  const localScript = await fs.readFile(processPyPath, 'utf8');

  const pod = withTemplateValues(template, {
    podName,
    sessionId,
    image: 'sandbox:spike',
  });

  let portForwardStop: (() => Promise<void>) | null = null;
  let baseUrl = '';

  try {
    await createPod(handles, pod);
    await waitForPodReady(handles, podName, { t0CreateRequested: nowMs() });

    const localPort = await findFreePort(33001, 34000);
    const portForward = await startPortForward(podName, localPort, namespace);
    portForwardStop = portForward.stop;
    baseUrl = `http://127.0.0.1:${localPort}`;

    await waitForHealth(baseUrl);

    await callJson<{ ok: true }>(baseUrl, 'POST', '/files/write', {
      path: '/skills/SKILL.md',
      content: localSkill,
    });

    await callJson<{ ok: true }>(baseUrl, 'POST', '/files/write', {
      path: '/skills/process.py',
      content: localScript,
    });

    const skillResult = await callJson<ReadFileResponse>(baseUrl, 'POST', '/files/read', {
      path: '/skills/SKILL.md',
    });

    if (!skillResult.content.includes('name: test-skill')) {
      throw new Error('seeded skill file does not match expected content');
    }

    const cmdResult = await callJson<CommandResponse>(baseUrl, 'POST', '/command/run', {
      cmd: 'python3 /skills/process.py',
    });

    if (cmdResult.exitCode !== 0) {
      throw new Error(`process.py failed unexpectedly: ${JSON.stringify(cmdResult)}`);
    }

    const outputResult = await callJson<ReadFileResponse>(baseUrl, 'POST', '/files/read', {
      path: '/workspace/result.txt',
    });

    if (!outputResult.content.includes('processed-by-python')) {
      throw new Error('result.txt missing expected marker');
    }

    const listResult = await callJson<CommandResponse>(baseUrl, 'POST', '/command/run', {
      cmd: 'ls -la /workspace/',
    });

    if (!listResult.stdout.includes('result.txt')) {
      throw new Error('workspace listing does not contain result.txt');
    }

    const artifactPath = path.resolve(__dirname, '..', 'artifacts', `result-${sessionId}.txt`);
    await saveArtifact(artifactPath, outputResult.content);

    const nonZero = await callJson<CommandResponse>(baseUrl, 'POST', '/command/run', {
      cmd: 'python3 -c "import sys; sys.exit(7)"',
    });

    if (nonZero.exitCode !== 7) {
      throw new Error(`expected non-zero exit code 7, got ${String(nonZero.exitCode)}`);
    }

    let missingFileError = '';
    try {
      await callJson<ReadFileResponse>(baseUrl, 'POST', '/files/read', {
        path: '/workspace/does-not-exist.txt',
      });
    } catch (error) {
      missingFileError = error instanceof Error ? error.message : String(error);
    }

    if (!missingFileError.includes('HTTP 404')) {
      throw new Error('missing file did not return HTTP 404');
    }

    let writeSkillsAllowed = false;
    try {
      await callJson<{ ok: true }>(baseUrl, 'POST', '/files/write', {
        path: '/skills/write-check.txt',
        content: 'allowed-for-spike',
      });
      writeSkillsAllowed = true;
    } catch {
      writeSkillsAllowed = false;
    }

    // eslint-disable-next-line no-console
    console.log(`Write /skills policy: ${writeSkillsAllowed ? 'allowed' : 'rejected'}`);

    const inFlightCommand = callJson<CommandResponse>(baseUrl, 'POST', '/command/run', {
      cmd: 'sleep 20 && echo should-not-complete',
    });
    await sleep(500);

    await forceDeletePod(handles, podName);
    await waitForPodDeleted(handles, podName);

    let crashDetected = false;
    try {
      const inFlightResult = await inFlightCommand;
      crashDetected = inFlightResult.exitCode !== 0;
    } catch {
      crashDetected = true;
    }

    if (!crashDetected) {
      throw new Error('expected forced pod delete to break session calls');
    }

    if (portForwardStop) {
      await portForwardStop();
      portForwardStop = null;
    }

    const retrySessionId = `retry-${Date.now().toString(36)}`;
    const retryPodName = `sandbox-${retrySessionId}`;
    const retryPod = withTemplateValues(template, {
      podName: retryPodName,
      sessionId: retrySessionId,
      image: 'sandbox:spike',
    });

    await createPod(handles, retryPod);
    await waitForPodReady(handles, retryPodName, { t0CreateRequested: nowMs() });

    const retryPort = await findFreePort(34001, 35000);
    const retryPortForward = await startPortForward(retryPodName, retryPort, namespace);

    try {
      const retryBaseUrl = `http://127.0.0.1:${retryPort}`;
      await waitForHealth(retryBaseUrl);
      const retryCommand = await callJson<CommandResponse>(retryBaseUrl, 'POST', '/command/run', {
        cmd: 'echo retry-ok',
      });

      if (!retryCommand.stdout.includes('retry-ok')) {
        throw new Error('retry pod did not return expected command output');
      }
    } finally {
      await retryPortForward.stop();
    }

    await deletePod(handles, retryPodName);
    await waitForPodDeleted(handles, retryPodName);

    // eslint-disable-next-line no-console
    console.log('Session roundtrip and crash recovery succeeded.');
  } finally {
    if (portForwardStop) {
      await portForwardStop();
    }

    await deletePod(handles, podName);
    await waitForPodDeleted(handles, podName).catch(() => {
      // best-effort cleanup
    });
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
