# Spike: E2B as Sandbox Provider

## Context

### What is agent-bundle?

Agent-bundle is a tool that packages Agent Skills into a self-contained, deployable agent service. See `docs/proposal.md` for the full proposal.

### Why this spike?

We need to evaluate E2B as the sandbox layer for agent-bundle. In our architecture, the agent runtime (agent loop + LLM provider) runs **outside** E2B. E2B sandboxes serve as the **tool execution space** — when the agent loop makes a tool call (Bash, Read, Write, Edit), the command is forwarded into an E2B sandbox and results are returned.

### Architecture constraint: untrusted sandbox

The sandbox environment is **untrusted**. Our LLM API keys and internal secrets must never enter the sandbox. The data flow is:

```
Agent Runtime (trusted)              E2B Sandbox (untrusted)
┌──────────────────────┐             ┌──────────────────────┐
│  Agent Loop          │             │  /skills/ (read-only)│
│  LLM Provider        │── tool ───► │  /workspace/ (rw)    │
│  (holds API keys)    │◄─ result ── │  (no secrets here)   │
│                      │             │                      │
└──────────────────────┘             └──────────────────────┘
```

The agent loop calls LLM APIs from the trusted side, receives tool-use instructions, forwards the tool execution (e.g., `bash: pip install pandas && python analyze.py`) into the sandbox, and reads back the result. Users may put their own tokens inside the sandbox (their choice, their risk), but agent-bundle never does.

### Sandbox lifecycle we need to support

```
pre-mount ──► create sandbox ──► [agent session: tool calls] ──► destroy ──► post-unmount
(seed files)                                                      (extract artifacts)
```

---

## Prerequisites (Owner: @user)

These must be completed before the executor can begin.

- [x] Sign up at <https://e2b.dev> and create an account
- [x] Generate an API key from the E2B dashboard
- [x] Place the API key in `spikes/sandbox/e2b/.env`:
  ```
  E2B_API_KEY=e2b_...
  ```
- [x] Confirm which E2B plan is active (free tier is fine for this spike, but check sandbox limits: count, duration, concurrency)
- [x] Install the E2B CLI (optional, for template management):
  ```bash
  npm install -g @e2b/cli
  ```

---

## Research Tasks (Owner: executor)

### R1. Template configuration

**Goal**: Understand how E2B templates work and what our template needs.

- [x] Read E2B docs on custom templates: how are they defined? Dockerfile-based? Config file?
- [x] Determine what a minimal template for agent-bundle looks like (needs: bash, python3, common CLI tools like `git`, `curl`, `jq`)
- [x] Can templates include pre-installed skill files in `/skills/`? Or must files be injected at runtime?
- [x] What is the template build/push workflow?
- [x] Document findings below in the Findings section

### R2. SDK integration model

**Goal**: Confirm that E2B supports our "external orchestrator" model.

- [x] Review the E2B TypeScript/Python SDK. Can we: create a sandbox, send individual bash commands, read/write files, and destroy the sandbox — all from an external process?
- [x] Is there a persistent connection (WebSocket) or is it request/response (HTTP)?
- [x] What happens to the SDK connection if the orchestrator process crashes? Does the sandbox auto-terminate?
- [x] Document the SDK call sequence for our lifecycle: `create → write files → run commands → read files → destroy`

### R3. Filesystem read/write

**Goal**: Confirm file injection and extraction capabilities.

- [x] Can we write files into the sandbox at creation time (before any command runs)?
- [x] Can we write files into a specific path (e.g., `/skills/skill-a/SKILL.md`)?
- [x] Can we read files back from the sandbox (e.g., `/workspace/output.json`) before destroying it?
- [x] Can we read a directory listing? (Needed for post-unmount artifact collection)
- [x] Is there a size limit on file upload/download?
- [x] Is there snapshot or volume persistence support? (for warm pool strategy later)

### R4. Network and outbound access

**Goal**: Confirm sandbox network behavior.

- [x] Can the sandbox make outbound HTTP requests by default? (Needed if user skills call external APIs)
- [x] Can outbound access be restricted or disabled?
- [x] Can we expose a port from the sandbox? (Not needed for v1, but good to know)
- [x] Confirm: there is no need for the sandbox to call LLM APIs (our architecture handles that outside)

### R5. Cost model

**Goal**: Understand pricing to assess viability.

- [x] What is the billing unit? (per sandbox-second? per sandbox-minute?)
- [x] Is an idle sandbox (created but no commands running) billed the same as an active one?
- [x] Can a sandbox be paused/hibernated to save cost? (Relevant for warm pool)
- [x] What are the free tier limits?
- [x] Estimate cost for: 100 sessions/day, average 5 minutes each

### R6. Fault tolerance

**Goal**: Understand failure modes and recovery.

- [x] What happens when a sandbox hits its max duration timeout?
- [x] Can we set a custom timeout per sandbox?
- [x] What happens if a command inside the sandbox hangs? Can we kill it from outside?
- [x] What happens if the orchestrator loses connection mid-session? Does the sandbox self-destruct?
- [x] Is there a way to list/cleanup orphaned sandboxes?

---

## Implementation Tasks (Owner: executor)

These depend on research tasks being completed first.

### I1. Minimal end-to-end flow

**Depends on**: R1, R2, R3 complete

- [x] Write a minimal script (`spike.ts` or `spike.py`) that:
  1. Creates an E2B sandbox (default or custom template)
  2. Writes a file to `/skills/hello/SKILL.md` with dummy content
  3. Writes a file to `/workspace/input.txt`
  4. Runs a bash command: `cat /skills/hello/SKILL.md && echo "processed" > /workspace/output.txt`
  5. Reads `/workspace/output.txt` back
  6. Destroys the sandbox
  7. Prints the result
- [x] Record the wall-clock time for each step

### I2. Cold start baseline

**Depends on**: I1 complete

- [x] Run the create-to-first-command cycle 10 times
- [x] Record: p50, p90, p99 latency for sandbox creation
- [x] Test with default template vs custom template (if applicable)
- [x] Document results below

### I3. Fault tolerance test

**Depends on**: R6, I1 complete

- [x] Test: what happens if we don't explicitly destroy the sandbox? How long until auto-cleanup?
- [x] Test: kill the orchestrator process mid-session, then check if the sandbox is still alive
- [x] Test: run a command that hangs (`sleep 9999`), then try to kill it or destroy the sandbox from outside
- [x] Document results below

---

## Evaluation Criteria

After all tasks are complete, assess E2B against these criteria:

| Criteria | Minimum bar | Ideal |
|---|---|---|
| Cold start | < 5s | < 1s |
| File injection | Write files before first command | Write files at template build time |
| File extraction | Read files before destroy | Stream files during session |
| Fault tolerance | Auto-destroy on timeout | Configurable timeout + orphan cleanup |
| Cost | Viable for 100 sessions/day | Viable for 10k sessions/day |
| SDK ergonomics | Usable from TypeScript | Clean async API, good error messages |

---

## Findings

> Executor: append your research findings, test results, and notes below this line.
> Mark task checkboxes as `[x]` when done. If a task is blocked, note the reason.

### Execution Date

- Executed on 2026-02-20.

### Code and Artifacts

- Spike scripts (TypeScript):
  - `spikes/sandbox/e2b/src/run_plan.ts`
  - `spikes/sandbox/e2b/package.json`
  - `spikes/sandbox/e2b/tsconfig.json`
- Run outputs:
  - `spikes/sandbox/e2b/results/2026-02-20T06-02-31-138Z-i1.json`
  - `spikes/sandbox/e2b/results/2026-02-20T06-05-19-409Z-i2.json`
  - `spikes/sandbox/e2b/results/2026-02-20T06-06-34-491Z-i3.json`

### R1 Findings: Template configuration

- E2B templates are defined with Template SDK instructions (Dockerfile-like build steps) and then built/deployed to E2B infra (`Template.build`) ([template-sdk docs](https://e2b.dev/docs/templates/template-sdk), [how-it-works](https://e2b.dev/docs/templates/how-it-works)).
- Minimal agent-bundle template recommendation:
  - Base image: `Template().fromBaseImage()`
  - Add missing CLI tools: `jq` (default base already had `bash`, `python3`, `git`, `curl` in our probe)
  - Create expected paths: `/skills`, `/workspace`
- Verified default template toolchain probe:
  - present: `bash`, `python3`, `git`, `curl`
  - missing: `jq`
- Templates can include pre-installed skill files:
  - verified by building template with `.copy('tmp-skill/SKILL.md', '/skills/preinstalled/SKILL.md')` and reading file in sandbox.
- Build/push workflow:
  1. Define template with SDK (`Template()` chain).
  2. Build/deploy (`Template.build(template, 'name:tag')`) or CLI (`e2b template build -c e2b.Dockerfile`) ([CLI/tutorial](https://e2b.dev/docs/legacy/guide/custom-sandbox)).
  3. Create sandbox from built `name:tag`.

### R2 Findings: SDK integration model

- External orchestrator model works: from outside process we successfully executed `create → files.write → commands.run → files.read/list → kill`.
- SDK transport model:
  - Sandbox API/control path uses HTTP requests.
  - SDK internals use Connect transport over `fetch` (see `node_modules/e2b/dist/index.js` `createConnectTransport(... fetch ...)`), i.e. no mandatory single long-lived orchestrator WebSocket.
- Orchestrator crash behavior:
  - In I3 crash test, child process was SIGKILLed; sandbox remained `running` and required explicit cleanup.
- Lifecycle call sequence for agent-bundle confirmed:
  - `Sandbox.create(...)`
  - `sandbox.files.write(...)` (seed files/skills)
  - `sandbox.commands.run(...)`
  - `sandbox.files.read/list(...)` (artifact collection)
  - `sandbox.kill()` or `Sandbox.kill(id)`

### R3 Findings: Filesystem read/write

- Write before first command: yes (I1 wrote `/skills/hello/SKILL.md` and `/workspace/input.txt` before command execution).
- Write to specific path: yes (including `/skills/...`).
- Read outputs before destroy: yes (`/workspace/output.txt` in I1).
- Directory listing: yes (`sandbox.files.list('/workspace')` used in I1).
- Upload/download limits:
  - Official docs did not provide a clear hard file size limit.
  - Empirical probe succeeded for 20 MiB upload + 20 MiB readback in one operation.
- Persistence support:
  - `betaPause()` + `Sandbox.connect(id)` resumes sandbox with filesystem state intact (verified with `/workspace/persist.txt`).
  - Docs state paused sessions are not billed for vCPU/RAM, useful for warm-pool strategy ([persistent sandbox docs](https://e2b.dev/docs/sandbox/persistent-sandbox)).

### R4 Findings: Network and outbound access

- Outbound internet by default: yes ([internet access docs](https://e2b.dev/docs/sandbox/internet-access)); empirical `curl https://httpbin.org/ip` succeeded.
- Restrict/disable outbound:
  - `allowInternetAccess: false` works (empirical curl timed out / exit 28).
  - Fine-grained CIDR allow/deny rules are supported (`network.allowOut` / `network.denyOut`) ([internet access docs](https://e2b.dev/docs/sandbox/internet-access)).
- Port exposure:
  - `sandbox.getHost(port)` returns public host; docs show HTTP/WebSocket use.
  - Empirical sample host: `3000-<sandbox-id>.e2b.app`.
- Architecture confirmation:
  - No requirement for sandbox to call LLM APIs; keep LLM/API keys in trusted orchestrator side.

### R5 Findings: Cost model

- Billing unit:
  - vCPU-seconds and memory-GB-seconds, billed per second ([billing FAQ](https://e2b.dev/docs/billing#how-is-billing-calculated)).
- Idle vs active billing:
  - No difference: running but idle sandbox is billed same as active ([billing FAQ](https://e2b.dev/docs/billing#how-does-session-duration-work)).
- Pause/hibernate:
  - Paused sessions stop vCPU/RAM billing (storage billed separately) ([persistent sandbox docs](https://e2b.dev/docs/sandbox/persistent-sandbox)).
- Free tier (Hobby) limits from pricing page:
  - Included usage: 200 monthly sandbox hours, 300 build minutes.
  - Max session duration: 1 hour.
  - Max concurrent sandboxes: 20.
  - Paid usage rates: $0.000014 per vCPU-second, $0.0000045 per GB-second RAM ([pricing](https://e2b.dev/pricing)).
- Cost estimate for 100 sessions/day, avg 5 minutes:
  - Total runtime/day = `100 * 300s = 30,000s`.
  - Observed default sandbox resources in this spike: `2 vCPU`, `512 MB`.
  - Per-second cost estimate:
    - CPU: `2 * 0.000014 = 0.000028`
    - RAM: `0.5 * 0.0000045 = 0.00000225`
    - Total: `0.00003025 USD/s`
  - Estimated daily cost: `30,000 * 0.00003025 = $0.9075/day`
  - Estimated monthly cost (30d): `~$27.23/month` (excluding plan base fee/taxes/storage).

### R6 Findings: Fault tolerance

- Max duration timeout behavior:
  - With `timeoutMs=45000`, sandbox disappeared at ~47.17s (poll observed `running -> not_found`).
- Custom timeout:
  - Supported (`timeoutMs` on create/connect and `setTimeout` API) ([set-timeout API](https://e2b.dev/docs/sdk-reference/js-sdk/v2.2.0/sandbox_settimeout)).
- Hanging command recovery:
  - `sleep 9999` process killed successfully via `sandbox.commands.kill(pid)`.
  - Destroy from outside also worked via `Sandbox.kill(sandboxId)`.
- Orchestrator disconnect/crash:
  - Child process crash did not auto-destroy sandbox; sandbox remained running until explicit kill.
- Orphan cleanup:
  - `Sandbox.list()` + `Sandbox.kill(id)` provides explicit cleanup path ([list](https://e2b.dev/docs/sdk-reference/js-sdk/v2.2.0/sandbox_list), [kill](https://e2b.dev/docs/sdk-reference/js-sdk/v2.2.0/sandbox_kill)).

### I1 Results: Minimal end-to-end flow

- Script implemented in `spikes/sandbox/e2b/src/run_plan.ts` (`npm run spike:i1`).
- Flow ran successfully:
  - wrote `/skills/hello/SKILL.md`
  - wrote `/workspace/input.txt`
  - ran command `cat ... && echo "processed" > /workspace/output.txt`
  - read output and listed workspace
  - destroyed sandbox
- Timing sample (ms):
  - create sandbox: `1595.82`
  - write skill file: `943.68`
  - write input file: `652.18`
  - run command: `232.15`
  - read output: `238.96`
  - list workspace: `233.58`
  - destroy sandbox: `287.25`

### I2 Results: Cold start baseline (10 runs)

- Script: `npm run spike:i2`
- Default template create latency:
  - p50: `285.63ms`
  - p90: `406.86ms`
  - p99: `859.29ms`
- Custom template:
  - Built template: `agent-bundle-spike-1771567480851:latest`
  - Build time: `14,328.86ms`
  - Create latency:
    - p50: `452.54ms`
    - p90: `517.57ms`
    - p99: `2145.83ms`
- Observation:
  - First custom sandbox had cold penalty (`2145.83ms`), subsequent runs were close to default range.

### I3 Results: Fault tolerance tests

- Script: `npm run spike:i3`
- Auto-cleanup without explicit destroy:
  - Timeout configured: `45000ms`
  - Observed cleanup: `47170ms`
- Kill orchestrator process mid-session:
  - Child process SIGKILLed; sandbox stayed `running`.
- Hanging command (`sleep 9999`):
  - PID kill succeeded (`killedByPid=true`, `pidStillPresentAfterKill=false`)
  - Sandbox outside-kill succeeded (`killSandboxFromOutside=true`, sandbox removed)

### Evaluation Against Criteria

| Criteria | Minimum bar | Actual (this spike) | Result |
|---|---|---|---|
| Cold start | < 5s | default p99 0.86s; custom p99 2.15s | Pass |
| File injection | Write files before first command | Pass; also template-time preinstall verified | Pass |
| File extraction | Read files before destroy | Pass (`files.read`, `files.list`) | Pass |
| Fault tolerance | Auto-destroy on timeout | Pass; timeout + explicit orphan cleanup path | Pass |
| Cost | Viable for 100 sessions/day | Estimated ~$27.23/mo usage at observed default shape | Likely pass |
| SDK ergonomics | Usable from TypeScript | Async API is straightforward; error messages actionable | Pass |

### Appendix (README Candidate): Additional Notes for Agent Bundle

#### A. Concrete E2B template config example

Template SDK example (recommended for this repo):

```ts
import { Template } from "e2b";

const template = Template()
  .fromBaseImage()
  .runCmd(
    [
      "apt-get update",
      "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends jq",
      "mkdir -p /skills /workspace",
      "rm -rf /var/lib/apt/lists/*",
    ],
    { user: "root" },
  )
  .copy("skills/", "/skills/");

const buildInfo = await Template.build(template, "agent-bundle-base:latest");
// buildInfo.name => "agent-bundle-base:latest"
```

Equivalent `e2b.Dockerfile` style (if we want CLI build workflow):

```dockerfile
FROM e2bdev/base:latest

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends jq && \
    mkdir -p /skills /workspace && \
    rm -rf /var/lib/apt/lists/*

COPY ./skills/ /skills/
```

#### B. Potential scenarios where E2B may not fit our proposal well

Potentially unsupported or high-risk for v1 (needs fallback/guardrails):

1. Very long-running sessions per request  
   Hobby has 1-hour max session duration; long workflows may need checkpoint + resume or task splitting.
2. Strict enterprise network/compliance environments  
   If deployment requires fully private network topology or strict data residency controls beyond E2B account controls, cloud sandbox may not pass policy.
3. Heavy kernel-level / privileged runtime requirements  
   Skills requiring privileged containers, custom kernel modules, or deep host integration are not a good fit.
4. Large user-specific immutable skill packs  
   If every tenant has a unique large `/skills` tree, template-per-tenant causes build/storage overhead; runtime injection is better.
5. Strong filesystem isolation semantics (hard read-only mount guarantees on `/skills`)  
   E2B provides filesystem APIs; strict read-only policy should be enforced in interpreter layer (path gate), not assumed by default.

#### C. Why add missing CLI tool `jq`

`jq` was added because:

1. In our probes, default sandbox already had `bash/python3/git/curl`, but `jq` was missing.
2. Many skills and lifecycle scripts are shell-first and frequently need JSON parsing (API responses, tool outputs, manifests).
3. Without `jq`, simple JSON transformations would require extra Python/Node snippets, increasing latency and script complexity.
4. Installing `jq` once at template build time keeps runtime commands small and deterministic.

#### D. Can we pre-build `/skills` into template?

Yes.

1. We verified `.copy(..., "/skills/...")` works and files are available immediately after sandbox creation.
2. Recommended strategy is hybrid:
   - Build stable/common skills into template.
   - Inject request/user-specific skills at runtime to avoid template explosion.
3. If proposal requires `/skills` read-only semantics, enforce no-write policy in interpreter after mount (deny `Write/Edit` to `/skills/**`).

#### E. Proposed E2B interpreter for proposal.md sandbox

Design goal: satisfy proposal lifecycle `pre-mount -> mount/session -> unmount -> post-unmount` while keeping secrets outside sandbox.

Core interface (runtime side):

```ts
type SessionConfig = {
  runId: string;
  template: string;
  timeoutMs: number;
  network: { allowInternetAccess: boolean; allowOut?: string[]; denyOut?: string[] };
};

interface SandboxInterpreter {
  createSession(cfg: SessionConfig): Promise<{ sandboxId: string }>;
  execTool(sandboxId: string, tool: "bash" | "read" | "write" | "edit", input: unknown): Promise<unknown>;
  collectArtifacts(sandboxId: string, globs: string[]): Promise<Record<string, string>>;
  destroySession(sandboxId: string): Promise<void>;
}
```

Execution model:

1. `pre-mount` (trusted runtime):
   - resolve selected skills + workspace seed files
   - validate permission policy (path allowlist/network policy)
2. `mount`:
   - `Sandbox.create(template, { timeoutMs, network/... })`
   - write files into `/skills` and `/workspace` (or rely on prebuilt `/skills`)
3. `agent session`:
   - `bash` -> `sandbox.commands.run(cmd, { timeoutMs })`
   - `read` -> `sandbox.files.read(path)`
   - `write/edit` -> `sandbox.files.write(path, data)` with path policy checks
4. `unmount`:
   - list and read artifacts from `/workspace` (`files.list/read`)
5. `post-unmount`:
   - upload artifacts to external storage
   - `sandbox.kill()`

Reliability controls:

1. Tag all sandboxes with metadata (`runId`, `bundleId`, `createdAt`) for orphan sweeper.
2. Startup sweeper: `Sandbox.list(query.metadata...)` then `Sandbox.kill(id)` for stale sessions.
3. Heartbeat/timeout extension: call `setTimeout` for long steps.
4. Crash-safe logs: persist command start/end, exitCode, stderr, and artifact manifest outside sandbox.

Security alignment with proposal:

1. LLM keys remain in trusted runtime; never injected into sandbox env.
2. Optional outbound deny-by-default policy for skill execution.
3. `/skills` write-protection enforced at interpreter policy layer.
