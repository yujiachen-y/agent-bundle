# System Prompt Pre-generation Spike Conclusion

## Verdict: Validated

Build-time system prompt generation works. pi-mono supports direct prompt injection, bypassing its built-in prompt assembly entirely.

## Key Numbers

| Metric | Value |
|---|---|
| Runtime replacement cost | 0.001 ms |
| Base prompt tokens | 136 |
| Description-only (3 skills) | 254 tokens |
| Full-body (3 skills) | 742 tokens |
| Token savings (10 skills, description-only vs full) | ~1,627 tokens |

## Findings

### Build-time generation

The generator reads a bundle YAML, parses SKILL.md frontmatter, and produces a system prompt template with `{{session_context}}` placeholder. Per-skill `prompt: full` is opt-in; default is description-only.

### pi-mono prompt model

pi-mono already uses progressive disclosure — system prompt includes only `name`, `description`, `location` per skill. Full SKILL.md body is read on demand. This matches our default description-only behavior.

The difference: pi-mono builds this dynamically at startup. We freeze it at build time. Same output, zero runtime cost.

### Direct prompt injection path

The spike confirmed a clean injection path: `session.agent.setSystemPrompt(prompt)` followed by `session.agent.prompt(messages)`. This bypasses pi-mono's `buildSystemPrompt()` entirely — pi-mono is used only as the execution loop and tool runtime. See PLAN.md "Direct Prompt Injection Example" for the full code.

### Token budget

| Config | 3 skills | 5 skills (est.) | 10 skills (est.) |
|---|---|---|---|
| Description-only | 254 | ~333 | ~529 |
| Full-body | 742 | ~1,146 | ~2,156 |
| **Savings** | **488** | **~813** | **~1,627** |

Description-only keeps the system prompt under 600 tokens for most bundles.

### Dynamic context

pi-mono injects runtime-only context (date/time, cwd, tool set, AGENTS files). In our model:

- **cwd**: fixed to `/workspace/` — pre-generatable
- **tool set**: fixed (Bash, Read, Write, Edit) — pre-generatable
- **date/time**: `{{session_context}}` placeholder, filled at runtime
- **AGENTS/CLAUDE files**: not applicable — skills replace this

Only date/time needs runtime injection.

## Evaluation

| Criteria | Result |
|---|---|
| Build-time generation | Pass — configurable per-skill (description vs full) |
| Runtime cost | Pass — 0.001ms (< 1ms target) |
| Agent behavior | Pass — agent knows skills, reads SKILL.md on demand |
| Token efficiency | Pass — description-only saves ~1,627 tokens at 10 skills |
