import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callJson,
  cleanupAgentSandboxPods,
  createKubeClients,
  createPod,
  deletePod,
  findFreePort,
  formatDuration,
  LifecycleMarks,
  loadPodTemplate,
  nowMs,
  startPortForward,
  waitForHealth,
  waitForPodDeleted,
  waitForPodReady,
  withTemplateValues,
} from './lib/sandbox.js';

type HealthResponse = { status: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run(): Promise<void> {
  const namespace = 'default';
  const handles = createKubeClients(namespace);
  const templatePath = path.resolve(__dirname, '..', 'sandbox-pod.yaml');
  const template = await loadPodTemplate(templatePath);

  const sessionId = `sess-${Date.now().toString(36)}`;
  const podName = `sandbox-${sessionId}`;
  const marks: LifecycleMarks = { t0CreateRequested: nowMs() };

  const pod = withTemplateValues(template, {
    podName,
    sessionId,
    image: 'sandbox:spike',
  });

  await createPod(handles, pod);
  await waitForPodReady(handles, podName, marks);

  const localPort = await findFreePort(32000, 33000);
  const pf = await startPortForward(podName, localPort, namespace);

  try {
    const baseUrl = `http://127.0.0.1:${localPort}`;
    await waitForHealth(baseUrl);
    marks.t4HealthOk = nowMs();

    const health = await callJson<HealthResponse>(baseUrl, 'GET', '/health');
    if (health.status !== 'ok') {
      throw new Error(`unexpected health payload: ${JSON.stringify(health)}`);
    }
  } finally {
    await pf.stop();
  }

  await deletePod(handles, podName);
  await waitForPodDeleted(handles, podName);

  const orphanSessionId = `orphan-${Date.now().toString(36)}`;
  const orphanPodName = `sandbox-${orphanSessionId}`;
  const orphanPod = withTemplateValues(template, {
    podName: orphanPodName,
    sessionId: orphanSessionId,
    image: 'sandbox:spike',
  });

  await createPod(handles, orphanPod);
  await waitForPodReady(handles, orphanPodName, { t0CreateRequested: nowMs() });

  const cleanupOutput = await cleanupAgentSandboxPods(namespace);
  await waitForPodDeleted(handles, orphanPodName);

  // eslint-disable-next-line no-console
  console.log('Lifecycle timing summary:');
  // eslint-disable-next-line no-console
  console.log(`T0 create request -> T1 scheduled: ${formatDuration(marks.t0CreateRequested, marks.t1Scheduled)}`);
  // eslint-disable-next-line no-console
  console.log(`T1 scheduled -> T2 running: ${formatDuration(marks.t1Scheduled ?? marks.t0CreateRequested, marks.t2Running)}`);
  // eslint-disable-next-line no-console
  console.log(`T2 running -> T3 ready: ${formatDuration(marks.t2Running ?? marks.t0CreateRequested, marks.t3Ready)}`);
  // eslint-disable-next-line no-console
  console.log(`T3 ready -> T4 health-ok: ${formatDuration(marks.t3Ready ?? marks.t0CreateRequested, marks.t4HealthOk)}`);
  // eslint-disable-next-line no-console
  console.log(`Total T0 -> T4: ${formatDuration(marks.t0CreateRequested, marks.t4HealthOk)}`);

  // eslint-disable-next-line no-console
  console.log('Cleanup command output:');
  // eslint-disable-next-line no-console
  console.log(cleanupOutput || '(no pods matched)');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
