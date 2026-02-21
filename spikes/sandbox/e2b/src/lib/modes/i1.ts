import { Sandbox } from "e2b";

import { DEFAULT_TIMEOUT_MS } from "../constants.js";
import { safeKillSandbox } from "../sandbox_helpers.js";
import type { I1Result, StepTiming } from "../types.js";
import { nowIso, timed } from "../utils/time.js";

const SKILL_FILE_PATH = "/skills/hello/SKILL.md";
const INPUT_FILE_PATH = "/workspace/input.txt";
const OUTPUT_FILE_PATH = "/workspace/output.txt";

export async function runI1(): Promise<I1Result> {
  const timings: StepTiming[] = [];
  let sandbox: Sandbox | null = null;

  try {
    sandbox = await timed("create_sandbox", timings, () =>
      Sandbox.create({
        timeoutMs: DEFAULT_TIMEOUT_MS,
        metadata: { spike: "i1", startedAt: nowIso() },
      }),
    );
    const activeSandbox = sandbox;

    await timed("write_skill_file", timings, () =>
      activeSandbox.files.write(SKILL_FILE_PATH, "# Hello Skill\nThis is a dummy skill file for E2B spike.\n"),
    );

    await timed("write_input_file", timings, () =>
      activeSandbox.files.write(INPUT_FILE_PATH, "hello from agent-bundle\n"),
    );

    const command = await timed("run_command", timings, () =>
      activeSandbox.commands.run(`cat ${SKILL_FILE_PATH} && echo "processed" > ${OUTPUT_FILE_PATH}`),
    );

    const outputText = await timed("read_output_file", timings, () =>
      activeSandbox.files.read(OUTPUT_FILE_PATH),
    );

    const workspaceListing = await timed("list_workspace", timings, () =>
      activeSandbox.files.list("/workspace"),
    );

    await timed("destroy_sandbox", timings, () => activeSandbox.kill());
    const sandboxId = activeSandbox.sandboxId;
    sandbox = null;

    return {
      sandboxId,
      timings,
      command,
      outputText,
      workspaceEntries: workspaceListing.map((entry) => entry.path),
    };
  } finally {
    await safeKillSandbox(sandbox);
  }
}
