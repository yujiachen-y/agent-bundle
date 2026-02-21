import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callJson,
  createKubeClients,
  createPod,
  deletePod,
  findFreePort,
  formatDuration,
  loadPodTemplate,
  nowMs,
  percentile,
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

type ColdStartRun = {
  runIndex: number;
  t0: number;
  t1?: number;
  t2?: number;
  t3?: number;
  t4?: number;
  total?: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(): { runs: number; image: string } {
  const runsArg = process.argv.find((arg) => arg.startsWith('--runs='));
  const imageArg = process.argv.find((arg) => arg.startsWith('--image='));
  const runs = runsArg ? Number(runsArg.split('=')[1]) : 5;
  const image = imageArg ? imageArg.split('=')[1] : 'sandbox:spike';
  return { runs, image };
}

async function runOne(image: string, runIndex: number): Promise<ColdStartRun> {
  const handles = createKubeClients('default');
  const templatePath = path.resolve(__dirname, '..', 'sandbox-pod.yaml');
  const template = await loadPodTemplate(templatePath);

  const sessionId = `cold-${runIndex}-${Date.now().toString(36)}`;
  const podName = `sandbox-${sessionId}`;

  const marks: ColdStartRun = {
    runIndex,
    t0: nowMs(),
  };

  const pod = withTemplateValues(template, {
    podName,
    sessionId,
    image,
  });

  let portForwardStop: (() => Promise<void>) | null = null;

  try {
    await createPod(handles, pod);
    await waitForPodReady(handles, podName, {
      t0CreateRequested: marks.t0,
      get t1Scheduled() {
        return marks.t1;
      },
      set t1Scheduled(value: number | undefined) {
        marks.t1 = value;
      },
      get t2Running() {
        return marks.t2;
      },
      set t2Running(value: number | undefined) {
        marks.t2 = value;
      },
      get t3Ready() {
        return marks.t3;
      },
      set t3Ready(value: number | undefined) {
        marks.t3 = value;
      },
    });

    const port = await findFreePort(35001, 36000);
    const pf = await startPortForward(podName, port, 'default');
    portForwardStop = pf.stop;

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl);

    const firstCommand = await callJson<CommandResponse>(baseUrl, 'POST', '/command/run', {
      cmd: 'echo first-command',
    });

    if (firstCommand.exitCode !== 0 || !firstCommand.stdout.includes('first-command')) {
      throw new Error(`unexpected first command result: ${JSON.stringify(firstCommand)}`);
    }

    marks.t4 = nowMs();
    marks.total = marks.t4 - marks.t0;

    return marks;
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

async function run(): Promise<void> {
  const { runs, image } = parseArgs();
  const results: ColdStartRun[] = [];

  for (let i = 0; i < runs; i += 1) {
    const result = await runOne(image, i + 1);
    results.push(result);
  }

  const totals = results
    .map((r) => r.total)
    .filter((value): value is number => typeof value === 'number');

  console.log(`Cold start results for image=${image}`);
  for (const result of results) {
    console.log(
      [
        `run=${result.runIndex}`,
        `T0->T1 ${formatDuration(result.t0, result.t1)}`,
        `T1->T2 ${formatDuration(result.t1 ?? result.t0, result.t2)}`,
        `T2->T3 ${formatDuration(result.t2 ?? result.t0, result.t3)}`,
        `T3->T4 ${formatDuration(result.t3 ?? result.t0, result.t4)}`,
        `TOTAL ${formatDuration(result.t0, result.t4)}`,
      ].join(' | '),
    );
  }

  console.log(`p50 TOTAL: ${percentile(totals, 50)}ms`);
  console.log(`p90 TOTAL: ${percentile(totals, 90)}ms`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
