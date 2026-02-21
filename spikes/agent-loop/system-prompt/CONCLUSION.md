# System Prompt Pre-generation Spike Conclusion

## Verdict: Validated, ready for implementation

Build-time system prompt generation works as designed. All evaluation criteria pass.

## Key Numbers

| Metric | Value |
|---|---|
| Runtime replacement cost | 0.001 ms (well under 1ms target) |
| Base prompt tokens | 136 |
| Description-only (3 skills) | 254 tokens |
| Full-body (3 skills) | 742 tokens |
| Token savings (10 skills, description-only vs full) | ~1,627 tokens saved |

## What was validated

### 1. Build-time generation works

The generator reads a bundle YAML, parses SKILL.md frontmatter, and produces a system prompt template. Per-skill `prompt: full` configuration works — skills default to description-only, opt-in for full body.

Produced artifacts:
- `dist/system-prompt.txt` (mixed mode)
- `dist/system-prompt.description-only.txt`
- `dist/system-prompt.full.txt`

### 2. Runtime cost is negligible

Single `{{session_context}}` placeholder replacement: **0.001 ms**. No file scanning, no SKILL.md parsing, no frontmatter extraction at runtime.

### 3. Agent behavior is correct

E2E test confirmed:
- Agent knows skill names and descriptions from the pre-generated prompt (no file reads needed).
- Agent can list available skills without tool calls.
- Agent reads full SKILL.md on demand when it needs detailed instructions (via `read` tool → sandbox file read).
- Without the pre-generated prompt, the agent does not know about the custom skills (baseline comparison passed).

### 4. pi-mono's prompt model confirms our approach

pi-mono already uses progressive disclosure:
- System prompt includes only `name`, `description`, `location` per skill.
- Full SKILL.md body is read on demand.
- This matches our default `description-only` behavior.

The key difference: pi-mono builds this dynamically at startup. We freeze it at build time. Same output, zero runtime cost.

## Token budget analysis

| Config | 3 skills | 5 skills (est.) | 10 skills (est.) |
|---|---|---|---|
| Description-only | 254 | ~333 | ~529 |
| Full-body | 742 | ~1,146 | ~2,156 |
| **Savings** | **488** | **~813** | **~1,627** |

Description-only is the right default. For most bundles (5-10 skills), it keeps the system prompt under 600 tokens. Full-body should be opt-in for skills where the agent needs detailed instructions without a round-trip.

## Dynamic context that cannot be pre-generated

pi-mono injects some runtime-only context into the system prompt:

| Context | pi-mono behavior | agent-bundle approach |
|---|---|---|
| Current date/time | Injected at startup | `{{session_context}}` placeholder, filled at runtime |
| Working directory | Injected at startup | Fixed to `/workspace/` in sandbox — can be pre-generated |
| Active tool set | Injected at startup | Fixed (Bash, Read, Write, Edit) — can be pre-generated |
| AGENTS/CLAUDE files | Scanned from cwd | Not applicable — skills are the equivalent, already in prompt |

Only date/time truly needs runtime injection. Everything else is known at build time.

## Recommendation for agent-bundle

1. **`agent-bundle build`** generates `system-prompt.txt` as part of the build artifact, alongside the sandbox template/image.
2. **Runtime** reads the pre-generated template and replaces `{{session_context}}` (date/time, any per-session context). Cost: < 0.01ms.
3. **Default to description-only.** Users opt in to full-body per skill via `prompt: full` in bundle YAML.
4. **The agent can always `sandbox.file.read("/skills/<name>/SKILL.md")`** for full details on demand. This is consistent with pi-mono's progressive disclosure model.
