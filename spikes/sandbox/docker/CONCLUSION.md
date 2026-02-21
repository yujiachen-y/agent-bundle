# Spike Conclusion: Kubernetes-based Sandbox

## Verdict

**Go.** The K8s sandbox approach is viable for agent-bundle. All four validation objectives are met.

## What Was Validated

| Objective | Result | Key Numbers |
|---|---|---|
| Pod lifecycle management | Create/destroy works reliably via `@kubernetes/client-node` SDK. Orphan cleanup via label selector works. | Create → ready: p50 1.6s |
| Host ↔ pod communication | execd HTTP daemon pattern works. Command execution, file read/write all functional. Path traversal protection in place. | ~66ms overhead per health check roundtrip |
| File seed/collect lifecycle | Pre-mount (upload skills), agent session (execute + read/write workspace), post-unmount (download artifacts) all validated. | Full session roundtrip: ~7s including pod setup |
| Concurrency | 5 simultaneous pods, 0 failures. Per-pod footprint: 14m CPU, 14Mi RAM. | Wall time: 34.5s for 5 parallel sessions |

## What Was NOT Validated (and doesn't need to be yet)

- **PVC-backed crash recovery**: The spike tested "crash → detect → new pod → retry" which matches the proposal's stateless design (Non-Goal 2). Volume-backed persistence was not tested.
- **In-cluster networking**: The spike used `kubectl port-forward` for host ↔ pod transport. Production needs K8s Service or direct pod IP access.
- **`/skills/` read-only enforcement**: Currently permissive at the execd level. Production should enforce via K8s volume mount options or execd-level policy.
- **Real-world image sizes**: The spike image (~192 MiB) includes Node.js + Python. Production images with heavier skill dependencies (e.g., ffmpeg, ML libraries) need separate measurement.
- **Remote cluster behavior**: All testing was on local k3d. Network latency, image pull times, and scheduling behavior will differ on Civo or managed K8s.

## Architecture Decisions Confirmed

1. **execd daemon pattern** — Works well. A minimal HTTP server inside each pod (~145 lines) handles all tool commands. No need for `docker exec`, stdio protocols, or Unix sockets.
2. **Alpine base image** — Same cold start as slim (~1.6s), ~90 MiB smaller. Use `node:22-alpine` as default.
3. **Stateless pod model** — Each session gets a fresh pod. No state carries over. Crash recovery = create new pod + replay pre-mount. Matches proposal's Non-Goal 2.
4. **Label-based cleanup** — `kubectl delete pods -l app=agent-sandbox` handles orphans. Simple, works.

## Mapping to Proposal

The spike validates the sandbox layer described in `docs/proposal.md` Design Overview:

| Proposal Component | Spike Artifact | Status |
|---|---|---|
| Sandbox Filesystem (`/skills/`, `/workspace/`) | `Dockerfile` creates both dirs; execd enforces path boundaries | Validated |
| Lifecycle hooks (pre-mount, post-unmount) | `test-session.ts` simulates seed → session → collect | Validated |
| Built-in Tools (Bash, Read, Write, Edit) | execd endpoints: `/command/run`, `/files/read`, `/files/write` | Validated (Edit not yet implemented in execd) |
| SandboxInterpreter interface | Appendix D in PLAN.md; `src/lib/sandbox.ts` is the prototype | Designed, partially implemented |

## Risks and Mitigations for Production

| Risk | Severity | Mitigation |
|---|---|---|
| `kubectl port-forward` doesn't scale | High | Replace with K8s Service + ClusterIP or in-cluster direct pod IP. The execd HTTP interface stays the same — only the transport changes. |
| `/skills/` is writable | Medium | Add `readOnly: true` to the volume mount in pod spec, or add an execd-level check rejecting writes to `/skills/`. |
| Cold start may grow with heavier images | Medium | Measure with production-sized images early. Consider pre-pulling images to nodes or using warm pod pools (Appendix A's k3d config supports node labels for targeted scheduling). |
| execd has no authentication | Low (for now) | In k3d / internal cluster, pod networking is not exposed externally. For multi-tenant production, add a shared secret or mTLS between host and execd. |
| No output streaming (SSE) yet | Low | execd returns full stdout/stderr after command completes. For long-running commands, add SSE streaming. Not blocking for v1. |

## Recommended Next Steps

1. **Implement `SandboxInterpreter`** (Appendix D) as a proper module in the agent-bundle runtime, replacing the spike's ad-hoc test harnesses.
2. **Add `/files/edit` endpoint** to execd — the proposal lists Edit as a built-in tool, but the spike only implemented read/write.
3. **Enforce `/skills/` read-only** — either at K8s pod spec level or execd level.
4. **Test on a remote cluster** (Civo) to measure real-world image pull + scheduling latency.
5. **Integrate with agent loop** — connect the `SandboxInterpreter` to the pi-mono coding-agent tool proxy. This is the next major spike: end-to-end agent session with real LLM calls on the host and tool execution in the sandbox.

## Spike Artifacts

```
spikes/sandbox/docker/
├── PLAN.md                     # Task definitions and results
├── CONCLUSION.md               # This file
├── Dockerfile                  # Sandbox image (node:22-alpine + python3 + execd)
├── sandbox-pod.yaml            # K8s pod manifest template
├── package.json                # Spike dependencies
├── tsconfig.json
├── src/
│   ├── execd.mjs               # In-pod HTTP daemon (145 lines)
│   ├── lib/
│   │   └── sandbox.ts          # Host-side K8s + execd client library (355 lines)
│   ├── test-lifecycle.ts       # T2: pod create/destroy cycle
│   ├── test-session.ts         # T3: full session roundtrip + crash recovery
│   ├── test-coldstart.ts       # T4: cold start measurement
│   └── test-concurrency.ts     # T4: 5-pod parallel test
└── test-skill/
    ├── SKILL.md                # Sample skill for testing
    └── process.py              # Sample skill script
```
