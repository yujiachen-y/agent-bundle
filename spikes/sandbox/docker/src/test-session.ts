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

type FixtureFiles = {
  localSkill: string;
  localScript: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadFixtureFiles(): Promise<FixtureFiles> {
  const skillMdPath = path.resolve(__dirname, '..', 'test-skill', 'SKILL.md');
  const processPyPath = path.resolve(__dirname, '..', 'test-skill', 'process.py');
  const localSkill = await fs.readFile(skillMdPath, 'utf8');
  const localScript = await fs.readFile(processPyPath, 'utf8');
  return { localSkill, localScript };
}

function buildSessionPodName(sessionId: string): string {
  return `sandbox-${sessionId}`;
}

function buildSessionPod(template: Awaited<ReturnType<typeof loadPodTemplate>>, sessionId: string) {
  return withTemplateValues(template, {
    podName: buildSessionPodName(sessionId),
    sessionId,
    image: 'sandbox:spike',
  });
}

async function seedSkillFiles(baseUrl: string, fixtures: FixtureFiles): Promise<void> {
  await callJson<{ ok: true }>(baseUrl, 'POST', '/files/write', {
    path: '/skills/SKILL.md',
    content: fixtures.localSkill,
  });

  await callJson<{ ok: true }>(baseUrl, 'POST', '/files/write', {
    path: '/skills/process.py',
    content: fixtures.localScript,
  });
}

async function verifySkillSeed(baseUrl: string): Promise<void> {
  const skillResult = await callJson<ReadFileResponse>(baseUrl, 'POST', '/files/read', {
    path: '/skills/SKILL.md',
  });

  if (!skillResult.content.includes('name: test-skill')) {
    throw new Error('seeded skill file does not match expected content');
  }
}

async function verifyProcessOutput(baseUrl: string): Promise<string> {
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

  return outputResult.content;
}

async function verifyNonZeroExit(baseUrl: string): Promise<void> {
  const nonZero = await callJson<CommandResponse>(baseUrl, 'POST', '/command/run', {
    cmd: 'python3 -c "import sys; sys.exit(7)"',
  });

  if (nonZero.exitCode !== 7) {
    throw new Error(`expected non-zero exit code 7, got ${String(nonZero.exitCode)}`);
  }
}

async function verifyMissingFileReturns404(baseUrl: string): Promise<void> {
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
}

async function checkSkillsWritePolicy(baseUrl: string): Promise<boolean> {
  try {
    await callJson<{ ok: true }>(baseUrl, 'POST', '/files/write', {
      path: '/skills/write-check.txt',
      content: 'allowed-for-spike',
    });
    return true;
  } catch {
    return false;
  }
}

async function runSessionRoundtrip(baseUrl: string, fixtures: FixtureFiles, sessionId: string): Promise<void> {
  await seedSkillFiles(baseUrl, fixtures);
  await verifySkillSeed(baseUrl);

  const output = await verifyProcessOutput(baseUrl);
  const artifactPath = path.resolve(__dirname, '..', 'artifacts', `result-${sessionId}.txt`);
  await saveArtifact(artifactPath, output);

  await verifyNonZeroExit(baseUrl);
  await verifyMissingFileReturns404(baseUrl);

  const writeSkillsAllowed = await checkSkillsWritePolicy(baseUrl);
  console.log(`Write /skills policy: ${writeSkillsAllowed ? 'allowed' : 'rejected'}`);
}

async function expectInFlightCommandToFail(baseUrl: string, handles: ReturnType<typeof createKubeClients>, podName: string): Promise<void> {
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
}

async function runRetrySession(
  handles: ReturnType<typeof createKubeClients>,
  template: Awaited<ReturnType<typeof loadPodTemplate>>,
  namespace: string,
): Promise<void> {
  const retrySessionId = `retry-${Date.now().toString(36)}`;
  const retryPodName = buildSessionPodName(retrySessionId);
  const retryPod = buildSessionPod(template, retrySessionId);

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
}

async function run(): Promise<void> {
  const namespace = 'default';
  const handles = createKubeClients(namespace);
  const templatePath = path.resolve(__dirname, '..', 'sandbox-pod.yaml');
  const template = await loadPodTemplate(templatePath);
  const fixtures = await loadFixtureFiles();
  const sessionId = `sess-${Date.now().toString(36)}`;
  const podName = buildSessionPodName(sessionId);
  const pod = buildSessionPod(template, sessionId);

  let portForwardStop: (() => Promise<void>) | null = null;

  try {
    await createPod(handles, pod);
    await waitForPodReady(handles, podName, { t0CreateRequested: nowMs() });

    const localPort = await findFreePort(33001, 34000);
    const portForward = await startPortForward(podName, localPort, namespace);
    portForwardStop = portForward.stop;
    const baseUrl = `http://127.0.0.1:${localPort}`;
    await waitForHealth(baseUrl);
    await runSessionRoundtrip(baseUrl, fixtures, sessionId);
    await expectInFlightCommandToFail(baseUrl, handles, podName);

    if (portForwardStop) {
      await portForwardStop();
      portForwardStop = null;
    }

    await runRetrySession(handles, template, namespace);
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
  console.error(error);
  process.exitCode = 1;
});
