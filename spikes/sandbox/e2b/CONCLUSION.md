# E2B Spike Conclusion

## Verdict: Viable for v1, with caveats

E2B passes all evaluation criteria and is a suitable sandbox provider for agent-bundle's initial release. The core integration model (external orchestrator calling E2B as tool execution space) works as designed.

## Key Numbers

| Metric | Value | Notes |
|---|---|---|
| Sandbox create (default, p50) | 286 ms | Well under 5s bar |
| Sandbox create (custom, p50) | 453 ms | First-use cold penalty: 2.1s p99 |
| First command after create (p50) | ~1,000 ms | Consistent across both templates |
| **Effective "ready" latency** | **~1.3s** | create + first command; this is the real baseline |
| File write | 650–940 ms | Per-file, network-bound |
| Command execution | ~230 ms | After warmup |
| File read | ~240 ms | After warmup |
| Max tested file transfer | 20 MiB | Upload + readback succeeded |
| Estimated cost (100 sessions/day, 5 min avg) | ~$27/month | 2 vCPU, 512 MB default shape |

## What works well

1. **SDK model fits perfectly.** HTTP-based control plane, no persistent connection required. `create → files.write → commands.run → files.read → kill` maps directly to our lifecycle.
2. **Cold start is fast.** Sub-second p50 for sandbox creation. Even with first-command overhead (~1s), total ready time is ~1.3s — acceptable for agent sessions that run for minutes.
3. **File I/O is straightforward.** Write to arbitrary paths, read back, list directories. All confirmed working. No special API for "mounting" — just `files.write` before commands.
4. **Template system covers our needs.** Dockerfile-like build steps, pre-install tools and files, push once and create many sandboxes from the same template.
5. **Pause/resume exists.** `betaPause()` + `Sandbox.connect(id)` preserves filesystem state. Enables warm pool strategy in later iterations. Paused sandboxes stop vCPU/RAM billing.
6. **Network control is fine-grained.** Outbound on by default (skills can call external APIs), configurable deny rules, can fully disable internet access.

## Risks and mitigations

### Must address for v1

| Risk | Detail | Mitigation |
|---|---|---|
| **Orphan sandboxes on orchestrator crash** | Sandbox stays alive if orchestrator dies. No auto-cleanup tied to connection loss. | Build an orphan sweeper: tag every sandbox with `runId` + `createdAt` metadata, run periodic `Sandbox.list()` + `Sandbox.kill()` for stale entries. |
| **No hard read-only filesystem** | E2B has no native read-only mount. A skill's Bash command could overwrite `/skills/`. | Enforce write-protection at the interpreter layer: reject Write/Edit tool calls targeting `/skills/**` before forwarding to sandbox. |
| **First-command latency (~1s)** | Sandbox creation is fast but the first command has consistent ~1s overhead (likely process init in microVM). | Accept for v1. Not a bottleneck given that a single LLM turn takes 1–60s. Can pre-warm with a no-op command if needed. |

### Accept for v1, monitor for later

| Risk | Detail |
|---|---|
| **Vendor lock-in** | E2B is a managed service. Pricing, availability, and API stability are outside our control. Mitigation: abstract behind `SandboxInterpreter` interface so we can swap to Docker-local or Fly.io later. |
| **Hobby tier limits** | 1-hour max session, 20 concurrent sandboxes, 200 sandbox-hours/month. Sufficient for development and early users. Paid tiers remove these limits. |
| **Custom template memory default** | Custom template defaulted to 1024 MB vs default's 512 MB. Cost impact at scale is 2x on RAM billing. Investigate configuring resource shape explicitly. |
| **File transfer size limits** | 20 MiB confirmed empirically but no documented hard limit. Large artifact transfer (e.g., generated video files) may need alternative path (presigned URL upload from within sandbox). |

## Architecture recommendation

Based on the spike, the integration should be structured as:

```
┌─────────────────────────────────────┐
│         Agent Runtime (trusted)      │
│                                      │
│   Agent Loop ◄──► LLM Provider       │
│       │                              │
│       │ tool calls                   │
│       ▼                              │
│   SandboxInterpreter (interface)     │
│       │                              │
│       ├── E2BSandbox (v1)            │
│       ├── DockerLocalSandbox (later) │
│       └── FlyMachinesSandbox (later) │
└───────┬─────────────────────────────┘
        │ E2B SDK (HTTP)
        ▼
┌─────────────────────────────────────┐
│       E2B Sandbox (untrusted)        │
│   /skills/  /workspace/              │
└─────────────────────────────────────┘
```

The `SandboxInterpreter` interface proposed in PLAN.md Appendix E is a good starting point. Key refinements:

1. **Path policy enforcement** belongs in the interpreter layer, not inside the sandbox. Check every `write`/`edit` tool call against an allowlist before forwarding.
2. **Metadata tagging** (`runId`, `bundleId`, `createdAt`) on every `Sandbox.create()` call — non-negotiable for orphan sweeping.
3. **Timeout should be configurable per bundle**, not hardcoded. Default to a conservative value (e.g., 15 minutes) with user override in YAML config.

## Next steps

1. Define `SandboxInterpreter` interface in the main codebase.
2. Implement `E2BSandbox` adapter behind that interface.
3. Build orphan sweeper (can be a simple cron or startup-time cleanup).
4. Wire interpreter to agent loop: intercept tool calls → route to sandbox → return results.
5. Add resource shape configuration (vCPU, memory) to bundle YAML.
