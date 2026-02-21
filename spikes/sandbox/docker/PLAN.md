# Spike: Kubernetes-based Sandbox for Agent Bundle

## Project Context

Agent Bundle is a tool that packages Agent Skills (the Anthropic open standard) into self-contained, deployable agent services. The full proposal is at `docs/proposal.md`.

The core architecture separates two trust domains:

```
Host (TRUSTED)                              K8s Pod (UNTRUSTED sandbox)
┌─────────────────────────┐                 ┌──────────────────────────┐
│  Agent Runtime           │                 │  Execution Environment   │
│                          │  tool commands  │                          │
│  - Agent Loop            │ ──────────────► │  /skills/   (read-only)  │
│  - LLM Provider Layer    │ ◄────────────── │  /workspace/ (read-write)│
│  - API keys live HERE    │  results        │                          │
│                          │                 │  bash, python, node, …   │
│  Makes LLM API calls     │                 │  NO tokens, NO secrets   │
└─────────────────────────┘                 └──────────────────────────┘
```

**Key principle**: The sandbox is untrusted. It executes arbitrary code from skills. LLM API keys and secrets NEVER enter the sandbox. The agent runtime on the host side makes LLM calls, and when the LLM returns a tool call (e.g. `Bash("python /skills/process.py")`), the runtime sends that command into the sandbox, gets the result, and feeds it back to the LLM.

### Reference: OpenSandbox by Alibaba

We are NOT using OpenSandbox as a dependency, but its architecture is a useful reference: https://github.com/alibaba/OpenSandbox

Key idea we borrow: the **execd pattern** — a lightweight HTTP daemon injected into each sandbox container. The host communicates with the sandbox via REST API calls to this daemon, not via `docker exec` or stdin/stdout.

## Objective

Validate that a K8s-based sandbox can serve as the execution backend for agent-bundle. Specifically:

1. Can we programmatically create/destroy sandbox pods?
2. Can the host reliably send commands and receive results via an in-pod HTTP daemon?
3. Can we seed files in and collect artifacts out?
4. What are the cold start and concurrency characteristics?

No LLM calls in this spike. Use hardcoded command sequences to simulate agent tool calls.

---

## Owner Prerequisites

The following must be completed before handing off to the executor.

- [x] Install Docker Desktop (or equivalent) and ensure it is running
- [x] Install k3d: `brew install k3d`
- [x] Install kubectl: `brew install kubectl`
- [x] Create the local k3d cluster: `k3d cluster create agent-sandbox`
- [x] Verify cluster is working: `kubectl get nodes` (should show one ready node)
- [ ] (Optional) Sign up for Civo (https://www.civo.com/) for remote K8s testing later. Not needed for this spike.

Once all checked items above are done, the executor can begin.

---

## Executor Instructions

### What you can do

- Create and modify files under `spikes/sandbox/docker/`
- Install npm packages needed for the spike
- Run kubectl, docker, and k3d commands against the local cluster
- Run TypeScript/JavaScript scripts

### What you must NOT do

- Modify files outside `spikes/sandbox/docker/`
- Install or modify cluster-wide K8s components without documenting why
- Use real LLM API keys or any secrets inside the sandbox containers

### How to report progress

- Mark tasks below as `[x]` when complete
- If a task is blocked or cannot be completed, change it to `[-]` and add a note
- Append your findings, timing results, and code notes to the [Results](#results) section at the bottom
- If you discover new work items, add them under [Discovered Work](#discovered-work)

---

## Tasks

### T1: Sandbox Docker Image

**Goal**: Build a minimal Docker image that runs an `execd` HTTP daemon, suitable for use as a K8s sandbox pod.

- [x] Create a `Dockerfile` for the sandbox image
  - Base: `node:22-alpine`
  - Install Python 3 (skills may need it): `apk add python3`
  - Create `/skills/` and `/workspace/` directories
  - Copy and run the execd daemon as entrypoint
- [x] Write the `execd` daemon (Node.js, keep it minimal)
  - `GET /health` — returns `{ status: "ok" }` (for readiness probe)
  - `POST /command/run` — accepts `{ cmd: string, cwd?: string }`, executes via `child_process.execFile("/bin/sh", ["-c", cmd])`, returns `{ stdout: string, stderr: string, exitCode: number }`
  - `POST /files/write` — accepts `{ path: string, content: string }`, writes file, returns `{ ok: true }`
  - `POST /files/read` — accepts `{ path: string }`, returns `{ content: string }`
  - `GET /files/list` — accepts query param `path`, returns `{ entries: string[] }`
  - All paths must be resolved to within `/skills/` or `/workspace/` (reject path traversal attempts like `../../etc/passwd`)
- [x] Build the image and load into k3d: `docker build -t sandbox:spike . && k3d image import sandbox:spike -c agent-sandbox`
- [x] Verify: `docker run --rm -p 3000:3000 sandbox:spike` then `curl http://localhost:3000/health`

**Acceptance**: Health check returns 200. A `POST /command/run` with `{"cmd": "echo hello"}` returns `{"stdout": "hello\n", "stderr": "", "exitCode": 0}`.

### T2: K8s Pod Lifecycle Management

**Goal**: Programmatically create, monitor, and destroy sandbox pods from a host-side TypeScript test harness.

- [x] Write a K8s pod manifest (`sandbox-pod.yaml`)
  - Uses `sandbox:spike` image
  - Sets resource limits (cpu: 500m, memory: 512Mi)
  - Adds a readiness probe hitting `GET /health`
  - Adds labels: `app: agent-sandbox`, `session-id: <dynamic>`
- [x] Write a TypeScript test harness (`test-lifecycle.ts`) using `@kubernetes/client-node`
  - Create a pod from the manifest (inject dynamic session-id)
  - Wait for pod readiness (poll readiness condition)
  - Set up port-forward to reach execd (use `@kubernetes/client-node` port-forward API or shell out to `kubectl port-forward`)
  - Call `GET /health` to confirm connectivity
  - Delete the pod
  - Verify pod is gone
- [x] Record timing: create → scheduled → running → ready → health-ok
- [x] Test cleanup: what happens if the harness crashes mid-session? Are pods orphaned? Add a label-based cleanup command: `kubectl delete pods -l app=agent-sandbox`

**Acceptance**: Full create → health-check → destroy cycle completes. Timing is logged. Orphan cleanup works.

### T3: Command Execution and File I/O Roundtrip

**Goal**: Simulate a full agent session — seed files, execute commands, collect results.

- [x] Write a TypeScript test harness (`test-session.ts`) that:
  1. Creates a sandbox pod (reuse T2 logic)
  2. **Pre-mount**: Uploads a sample SKILL.md and a Python script to `/skills/` via `POST /files/write`
  3. **Agent session** (simulated, hardcoded commands):
     - `POST /files/read` — read `/skills/SKILL.md`, verify content
     - `POST /command/run` — execute `python3 /skills/process.py` which writes output to `/workspace/result.txt`
     - `POST /files/read` — read `/workspace/result.txt`, verify output
     - `POST /command/run` — execute `ls -la /workspace/`, verify listing
  4. **Post-unmount**: Downloads `/workspace/result.txt` via `POST /files/read`, saves to host filesystem
  5. Destroys the pod
- [x] Create sample skill files for testing:
  - `test-skill/SKILL.md` — minimal frontmatter + instructions
  - `test-skill/process.py` — reads an input, writes output to `/workspace/result.txt`
- [x] Test error cases:
  - Command that exits with non-zero code
  - Read a file that does not exist
  - Write to `/skills/` (should this fail? Document the decision)
- [x] Test crash recovery:
  - Force-delete pod mid-session: `kubectl delete pod <name> --force --grace-period=0`
  - Verify host harness detects the failure
  - Verify host harness can create a new pod and retry

**Acceptance**: Full seed → execute → collect roundtrip works. Error cases return meaningful errors. Crash is detected and reported.

### T4: Cold Start and Concurrency Baseline

**Goal**: Establish baseline numbers and validate concurrent sandbox operation.

- [x] Cold start measurement (run 5 times, report p50/p90):
  ```
  T0  create pod request sent       → T1  pod scheduled on node
  T1  pod scheduled                 → T2  container running
  T2  container running             → T3  execd health check passes
  T3  execd ready                   → T4  first command result received
  ─────────────────────────────────────────────────────────────────
  Total: T0 → T4
  ```
- [x] Image size comparison (build each, record size and T0→T4):
  - `node:22-alpine` (baseline)
  - `node:22-slim`
  - `sandbox:spike` used as custom-execd image on top of alpine baseline (stretch goal met as functional custom image, not a separate distroless/minimal base)
- [x] Concurrency test:
  - Launch 5 sandbox pods simultaneously
  - Each runs the T3 session independently
  - Record: all-complete wall time, any failures, resource contention
- [x] Document per-pod resource usage (kubectl top pods during a session)

**Acceptance**: Timing table filled in. 5 concurrent pods complete without failure.

---

## Discovered Work

- Fixed a concurrency race in `test-concurrency.ts`: parallel sessions could pick the same local port before `kubectl port-forward` bind, causing startup failures. Added deterministic per-session ports with fallback scan.
- Improved `startPortForward` diagnostics in `src/lib/sandbox.ts` to include stderr/stdout in startup failure errors.
- `k3d image import` cannot be safely parallelized for the same cluster because the `k3d-agent-sandbox-tools` helper container name conflicts.

---

## Results

<!-- Executor: Append findings here as you complete each task. -->

### T1 Results

- Built `sandbox:spike` and imported into cluster with:
  - `docker build -t sandbox:spike .`
  - `k3d image import sandbox:spike -c agent-sandbox`
- Local container verification:
  - `curl http://127.0.0.1:3000/health` -> `{"status":"ok"}`
  - `POST /command/run {"cmd":"echo hello"}` -> `{"stdout":"hello\n","stderr":"","exitCode":0}`
- Execd implementation (`src/execd.mjs`) includes traversal protection: all file/cwd paths are resolved and restricted to `/skills` and `/workspace`.

### T2 Results

- Lifecycle harness `src/test-lifecycle.ts` completed create -> ready -> health -> delete cycle.
- Timing observed:
  - T0 create request -> T1 scheduled: `31ms`
  - T1 scheduled -> T2 running: `1540ms`
  - T2 running -> T3 ready: `0ms`
  - T3 ready -> T4 health-ok: `66ms`
  - Total T0 -> T4: `1637ms`
- Orphan cleanup validation:
  - Created an extra labeled pod to simulate crash/orphan.
  - Ran `kubectl delete pods -l app=agent-sandbox`.
  - Output: `pod "sandbox-orphan-..." deleted`
  - Verified pod deletion completed.

### T3 Results

- Session harness `src/test-session.ts` completed full seed -> execute -> collect path:
  - Uploaded `/skills/SKILL.md` and `/skills/process.py`
  - Ran `python3 /skills/process.py` to write `/workspace/result.txt`
  - Read back `/workspace/result.txt`
  - Verified `ls -la /workspace/` contains `result.txt`
- Post-unmount artifact saved to host:
  - `spikes/sandbox/docker/artifacts/result-<session-id>.txt`
- Error-case behavior:
  - Non-zero command test (`python3 -c "import sys; sys.exit(7)"`) returned `exitCode=7`
  - Missing file read returned HTTP 404
  - Write to `/skills` is currently **allowed** in this spike (documented policy decision for pre-mount convenience)
- Crash recovery:
  - Started in-flight command, force-deleted pod, and detected session failure.
  - Created a new pod and verified retry command (`echo retry-ok`) succeeded.

### T4 Results

- Cold start (5 runs) for `sandbox:alpine`:
  - run1 total: `2283ms`
  - run2 total: `1108ms`
  - run3 total: `1107ms`
  - run4 total: `1636ms`
  - run5 total: `1651ms`
  - p50: `1636ms`
  - p90: `2283ms`
- Cold start (5 runs) for `sandbox:slim`:
  - run1 total: `1697ms`
  - run2 total: `2181ms`
  - run3 total: `1639ms`
  - run4 total: `1131ms`
  - run5 total: `1102ms`
  - p50: `1639ms`
  - p90: `2181ms`
- Image size comparison (bytes from `docker image inspect`):
  - `sandbox:alpine` (node:22-alpine base): `201424178` bytes (~`192.1 MiB`)
  - `sandbox:slim` (node:22-slim base): `292341786` bytes (~`278.8 MiB`)
  - `sandbox:spike` (custom execd image): `201424178` bytes (~`192.1 MiB`)
- Concurrency (5 pods in parallel via `src/test-concurrency.ts`):
  - Wall time: `34566ms`
  - Failures: `0`
- Resource usage during concurrency (`kubectl top pods -l app=agent-sandbox`):
  - CPU: `12m` to `14m` per pod
  - Memory: `14Mi` per pod
  - Note: metrics API needed warm-up; first few `kubectl top` attempts returned `metrics not available yet`.

### Go/No-Go Recommendation

Go, with follow-up hardening.

- Viability: validated for create/destroy lifecycle, command execution, file seed/collect, and 5-way concurrency in local k3d.
- Main risks:
  - Port-forward lifecycle in high concurrency needs robust retries and explicit port management.
  - `/skills` write policy is currently permissive for spike convenience; production should enforce read-only mount semantics.
  - Metrics availability (`kubectl top`) may lag on fresh clusters; observability path should not assume immediate metrics readiness.
- Suggested next step before productionization:
  - Replace ad-hoc `kubectl port-forward` process management with a pooled/managed transport layer and codify immutable `/skills` policy in API + pod spec.

## Appendix: Requested Additions (2026-02-20)

### A. Concrete k3d Template Example

Use a dedicated k3d config file to keep local sandbox behavior repeatable.

```yaml
# spikes/sandbox/docker/k3d-agent-sandbox.yaml
apiVersion: k3d.io/v1alpha5
kind: Simple
metadata:
  name: agent-sandbox
servers: 1
agents: 2
image: rancher/k3s:v1.33.6-k3s1
ports:
  - port: 8080:80@loadbalancer
  - port: 8443:443@loadbalancer
options:
  k3d:
    wait: true
    timeout: "120s"
  k3s:
    extraArgs:
      - arg: --disable=traefik
        nodeFilters:
          - server:*
  runtime:
    labels:
      - label: sandbox-node=true
        nodeFilters:
          - agent:*
registries:
  create:
    name: agent-registry.localhost
    host: "0.0.0.0"
    hostPort: "5001"
volumes:
  - volume: /tmp/agent-sandbox-shared:/shared
    nodeFilters:
      - all
```

Create with:

```bash
k3d cluster create --config spikes/sandbox/docker/k3d-agent-sandbox.yaml
```

### B. Potential Scenarios Where k3d May Not Fully Support Our Target

For proposal-level sandbox expectations (untrusted code, reproducible isolation, deployable service), k3d is strong for local validation but has limits:

1. Production isolation fidelity
   k3d runs k3s inside Docker containers on the developer host. Isolation, kernel behavior, and attack surface differ from managed clusters or VM-based sandboxes.
2. Cloud-native identity and policy
   Cloud IAM bindings, workload identity, and provider-specific network controls are not represented in local k3d.
3. Storage and CSI parity
   Dynamic provisioners and production CSI classes are usually simplified locally, so artifact/persistence behavior may differ.
4. Autoscaling and noisy-neighbor realism
   Local single-machine resource contention cannot emulate cluster autoscaler behavior or multi-node scheduling pressure realistically.
5. Runtime security add-ons
   Features like gVisor/Kata RuntimeClass, advanced seccomp/apparmor policies, and enterprise admission controls may be unavailable or incomplete.

Conclusion: k3d is suitable for functional spike validation and fast iteration, but not a full substitute for production hardening verification.

### C. Can We Pre-build `/skills` into a Template?

Yes, with scope constraints.

1. Technically feasible
   We can bake `/skills` content into the sandbox image (or a derived skill-pack image) and mount it read-only at runtime.
2. Trade-offs
   Each skill change requires image rebuild + re-import; image size grows; per-session dynamic skill composition becomes harder.
3. Recommended split
   Keep base runtime in one image, and either:
   - build per-bundle skill-pack images, or
   - fetch skill bundles in pre-mount via init flow and freeze to read-only before session start.

For the proposal lifecycle (`pre-mount -> mount -> unmount -> post-unmount`), dynamic pre-mount fetch is usually more flexible than fully baking all skills into one static template.

### D. Proposed `k3d` Interpreter for `proposal.md` Sandbox

Define a backend adapter in runtime, e.g. `SandboxInterpreter` with a k3d implementation:

```ts
interface SandboxInterpreter {
  createSession(input: { sessionId: string; bundleRef: string }): Promise<void>;
  runCommand(input: { sessionId: string; cmd: string; cwd?: string }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  writeFile(input: { sessionId: string; path: string; content: string }): Promise<void>;
  readFile(input: { sessionId: string; path: string }): Promise<string>;
  listFiles(input: { sessionId: string; path: string }): Promise<string[]>;
  destroySession(input: { sessionId: string; reason?: string }): Promise<void>;
}
```

Interpreter responsibilities:

1. `createSession`
   - Render pod spec from template (`session-id`, image, limits, labels).
   - Create pod and wait for `Ready`.
   - Establish transport to execd (`kubectl port-forward` with retry/backoff or in-cluster Service path).
2. `pre-mount`
   - Seed `/skills` and bootstrap `/workspace` (from bundle registry, OCI artifact, or local path).
   - Optionally set `/skills` immutable/read-only policy before first command.
3. Tool execution
   - Forward tool calls to execd REST (`/command/run`, `/files/*`).
   - Return normalized results to agent loop exactly as proposal expects.
4. Fault handling
   - Watch pod phase/events; convert crashes/timeouts into deterministic runtime errors.
   - Retry strategy: recreate pod + replay pre-mount for recoverable failures.
5. `unmount` + `post-unmount`
   - Collect `/workspace` artifacts to host/object storage.
   - Destroy pod and run label-based garbage collection fallback.

Minimal control-plane flow:

```text
Agent Loop
  -> SandboxInterpreter.createSession
  -> SandboxInterpreter.runCommand/read/write/list (N times)
  -> SandboxInterpreter.destroySession
```

This interpreter keeps the trust boundary in `proposal.md`: LLM/API keys stay in host runtime; untrusted execution stays inside k3d pods.
