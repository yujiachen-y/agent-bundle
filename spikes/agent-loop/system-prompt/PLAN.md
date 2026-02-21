# Spike: System Prompt Pre-generation

## Context

Coding agents like Codex build their system prompt at startup by scanning the working directory, reading skill files, and assembling instructions dynamically. This is fine for local CLI usage but adds latency for a deployed service where skills are fixed at build time.

Agent-bundle should **pre-generate the system prompt at build time** and include it in the deployment artifact. At runtime, only per-session placeholders need to be filled in.

### Design constraints

1. Skills are fixed at build time. No dynamic skill selection at runtime.
2. The system prompt is a single string template with placeholders (e.g., `{{session_context}}`).
3. By default, only skill **description** (from SKILL.md frontmatter) is included in the prompt. Full SKILL.md body inclusion is opt-in per skill.
4. The agent can still read full SKILL.md content on demand via `sandbox.file.read("/skills/<name>/SKILL.md")`.

### Prompt structure (target)

```
[Base instructions: agent identity, behavior rules, sandbox constraints]

## Available Skills

### <skill-name>
<skill description from frontmatter>

### <skill-name> (prompt: full)
<full SKILL.md body>

## Tools
[Tool definitions: Bash, Read, Write, Edit]
[All tool operations execute inside the sandbox]

{{session_context}}
```

### Bundle YAML skill configuration

```yaml
skills:
  - ./skills/pdf-extractor                  # default: description only
  - path: ./skills/data-validator
    prompt: full                             # include full SKILL.md body
```

---

## Prerequisites (Owner: @user)

- [ ] Prepare 2-3 sample skills with SKILL.md files (frontmatter with `name` and `description`, plus a body section)
- [ ] Confirm the SKILL.md frontmatter format (YAML frontmatter? key names?)

---

## Research Tasks (Owner: executor)

### R1. SKILL.md format

**Goal**: Understand the SKILL.md format used by Agent Skills standard.

- [ ] Read the Agent Skills spec (or pi-mono's skill loading code) to understand SKILL.md structure
- [ ] Document the frontmatter schema: which fields exist? (`name`, `description`, others?)
- [ ] Document how pi-mono currently builds its system prompt from skills (code path, template format)
- [ ] Identify what pi-mono includes in the system prompt vs what it leaves for on-demand reading

### R2. pi-mono system prompt assembly

**Goal**: Understand pi-mono's current prompt construction so we can replicate it at build time.

- [ ] Trace the code path from agent startup to first LLM call
- [ ] Extract the system prompt template / construction logic
- [ ] Document which parts are static (can be pre-generated) vs dynamic (must be runtime)
- [ ] Identify any runtime-only context that pi-mono injects (cwd, git status, env info, etc.)

### R3. Token budget estimation

**Goal**: Understand the token impact of different prompt strategies.

- [ ] For the sample skills, measure token count of: description-only vs full-body inclusion
- [ ] Estimate the system prompt token count for a typical bundle (5-10 skills)
- [ ] Document the trade-off: fewer prompt tokens vs agent needing to read SKILL.md on demand (extra tool call round-trip)

---

## Implementation Tasks (Owner: executor)

### I1. Build-time prompt generator

**Depends on**: R1, R2

- [ ] Write a script/function that:
  1. Reads a bundle YAML (skills list with optional `prompt: full`)
  2. For each skill, reads SKILL.md and extracts frontmatter
  3. Assembles the system prompt template with `{{session_context}}` placeholder
  4. Writes the result to a file (e.g., `dist/system-prompt.txt`)
- [ ] Test with sample skills
- [ ] Verify the output looks correct and is valid for LLM consumption

### I2. Runtime placeholder replacement

**Depends on**: I1

- [ ] Write a minimal runtime function that:
  1. Reads the pre-generated prompt template
  2. Replaces `{{session_context}}` with per-session data (or empty string if none)
  3. Returns the final system prompt string
- [ ] Measure the time cost: should be < 1ms (just string replace)

### I3. End-to-end test

**Depends on**: I1, I2

- [ ] Use the pre-generated system prompt to make an actual LLM call via pi-mono
- [ ] Verify the agent:
  1. Knows about the available skills (from the prompt)
  2. Can list skills without reading files
  3. Can read full SKILL.md on demand when needed (via sandbox or local file read)
- [ ] Compare behavior with pi-mono's default dynamic prompt construction

---

## Evaluation Criteria

| Criteria | Minimum bar | Ideal |
|---|---|---|
| Build-time generation | Produces a valid system prompt from SKILL.md files | Configurable per-skill (description vs full) |
| Runtime cost | < 10ms to prepare final prompt | < 1ms (single string replace) |
| Agent behavior | Agent knows skill names and descriptions | Agent behavior identical to dynamic prompt |
| Token efficiency | Description-only reduces tokens vs full inclusion | Measurable token savings documented |

---

## Findings

> Executor: append your findings below this line.
> Mark task checkboxes as `[x]` when done.
