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

## Research Tasks (Owner: executor)

### R1. SKILL.md format

**Goal**: Understand the SKILL.md format used by Agent Skills standard.

- [x] Read the Agent Skills spec (or pi-mono's skill loading code) to understand SKILL.md structure
- [x] Document the frontmatter schema: which fields exist? (`name`, `description`, others?)
- [x] Document how pi-mono currently builds its system prompt from skills (code path, template format)
- [x] Identify what pi-mono includes in the system prompt vs what it leaves for on-demand reading
- [x] Create 2-3 sample skills with SKILL.md files for testing (frontmatter with `name` and `description`, plus body)

### R2. pi-mono system prompt assembly

**Goal**: Understand pi-mono's current prompt construction so we can replicate it at build time.

- [x] Trace the code path from agent startup to first LLM call
- [x] Extract the system prompt template / construction logic
- [x] Document which parts are static (can be pre-generated) vs dynamic (must be runtime)
- [x] Identify any runtime-only context that pi-mono injects (cwd, git status, env info, etc.)

### R3. Token budget estimation

**Goal**: Understand the token impact of different prompt strategies.

- [x] For the sample skills, measure token count of: description-only vs full-body inclusion
- [x] Estimate the system prompt token count for a typical bundle (5-10 skills)
- [x] Document the trade-off: fewer prompt tokens vs agent needing to read SKILL.md on demand (extra tool call round-trip)

---

## Implementation Tasks (Owner: executor)

### I1. Build-time prompt generator

**Depends on**: R1, R2

- [x] Write a script/function that:
  1. Reads a bundle YAML (skills list with optional `prompt: full`)
  2. For each skill, reads SKILL.md and extracts frontmatter
  3. Assembles the system prompt template with `{{session_context}}` placeholder
  4. Writes the result to a file (e.g., `dist/system-prompt.txt`)
- [x] Test with sample skills
- [x] Verify the output looks correct and is valid for LLM consumption

### I2. Runtime placeholder replacement

**Depends on**: I1

- [x] Write a minimal runtime function that:
  1. Reads the pre-generated prompt template
  2. Replaces `{{session_context}}` with per-session data (or empty string if none)
  3. Returns the final system prompt string
- [x] Measure the time cost: should be < 1ms (just string replace)

### I3. End-to-end test

**Depends on**: I1, I2

- [x] Use the pre-generated system prompt to make an actual LLM call via pi-mono
- [x] Verify the agent:
  1. Knows about the available skills (from the prompt)
  2. Can list skills without reading files
  3. Can read full SKILL.md on demand when needed (via sandbox or local file read)
- [x] Compare behavior with pi-mono's default dynamic prompt construction

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

### Execution Date

- 2026-02-21

### R1: SKILL.md format findings

- Source used:
  - Agent Skills spec page: `https://agentskills.io/specification`
  - pi-mono docs and code (`/tmp/pi-mono-codex`, commit `3a3e37d`)
- pi-mono SKILL parsing behavior:
  - Frontmatter parsed in `packages/coding-agent/src/utils/frontmatter.ts`.
  - Skill loading/validation is in `packages/coding-agent/src/core/skills.ts`.
  - Enforced/recognized fields:
    - `description` is required for loading.
    - `name` falls back to parent directory if omitted.
    - `disable-model-invocation` hides skill from prompt.
  - Additional frontmatter fields are tolerated and ignored by loader logic.
- Created 3 sample skills:
  - `spikes/agent-loop/system-prompt/sample-skills/pdf-extractor/SKILL.md`
  - `spikes/agent-loop/system-prompt/sample-skills/data-validator/SKILL.md`
  - `spikes/agent-loop/system-prompt/sample-skills/release-notes/SKILL.md`

### R2: pi-mono prompt assembly findings

- Startup to first LLM call path:
  1. `packages/coding-agent/src/main.ts` -> `createAgentSession(...)`
  2. `packages/coding-agent/src/core/sdk.ts` -> `resourceLoader.reload()`
  3. `packages/coding-agent/src/core/agent-session.ts` -> `_buildRuntime()` -> `_rebuildSystemPrompt()`
  4. `packages/coding-agent/src/core/system-prompt.ts` -> `buildSystemPrompt(...)`
  5. `session.prompt(...)` -> `agent.prompt(...)`
- Skills in system prompt:
  - Built via `formatSkillsForPrompt(...)` in `packages/coding-agent/src/core/skills.ts`.
  - Includes `name`, `description`, `location` only.
  - Full SKILL.md body is not injected by default (progressive disclosure).
- Dynamic runtime-only prompt context in pi-mono:
  - Current date/time.
  - Current working directory.
  - Active tool set.
  - Loaded context files (AGENTS/CLAUDE files).
  - Discovered skills and custom prompt append/override files.
- Static/pre-generatable parts:
  - Base instruction text.
  - Tool descriptions.
  - Skill metadata section (when skills are fixed at build time).

### R3: token budget findings

- Measurement output: `spikes/agent-loop/system-prompt/results/token-analysis.json`
- Using tokenizer setting: `gpt-4o` (fallback `cl100k_base`).
- Results with 3 sample skills:
  - Base prompt: 136 tokens
  - Description-only: 254 tokens
  - Mixed (1 full, 2 description): 549 tokens
  - Full-body: 742 tokens
- Estimated totals:
  - 5 skills: description-only ~333, full-body ~1146 (savings ~813)
  - 10 skills: description-only ~529, full-body ~2156 (savings ~1627)
- Trade-off:
  - Description-only significantly reduces prompt tokens.
  - Full-body inclusion reduces tool round-trips but materially increases prompt size.

### I1: build-time generator implementation

- Added bundle and sample configs:
  - `spikes/agent-loop/system-prompt/bundle.sample.yaml`
  - `spikes/agent-loop/system-prompt/bundle.description-only.yaml`
  - `spikes/agent-loop/system-prompt/bundle.full.yaml`
- Added generator and parser:
  - `spikes/agent-loop/system-prompt/src/lib/frontmatter.mjs`
  - `spikes/agent-loop/system-prompt/src/lib/system-prompt-builder.mjs`
  - `spikes/agent-loop/system-prompt/src/generate-system-prompt.mjs`
- Generated templates:
  - `spikes/agent-loop/system-prompt/dist/system-prompt.txt`
  - `spikes/agent-loop/system-prompt/dist/system-prompt.description-only.txt`
  - `spikes/agent-loop/system-prompt/dist/system-prompt.full.txt`

### I2: runtime replacement implementation

- Added runtime replacement function:
  - `spikes/agent-loop/system-prompt/src/runtime-prompt.mjs`
- Benchmark script and results:
  - Script: `spikes/agent-loop/system-prompt/src/measure-runtime.mjs`
  - Result: `spikes/agent-loop/system-prompt/results/runtime-benchmark.json`
  - Average replacement cost: `0.001162 ms` (< 1ms target)

### I3: end-to-end validation

- Added e2e smoke script:
  - `spikes/agent-loop/system-prompt/src/e2e-pi-mono.mjs`
- Run result:
  - `spikes/agent-loop/system-prompt/results/e2e-smoke.json`
- Verified:
  - Agent knows skills from pre-generated prompt.
  - Agent lists skills without file reads.
  - Agent reads full SKILL.md on demand via `read` tool.
  - Baseline dynamic behavior (without injected prompt) does not expose the custom skill list.

### Direct Prompt Injection Example (Bypass Prompt Assembly)

```ts
import { SessionManager, createAgentSession } from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";

async function run() {
  // 1) Load your pre-generated prompt template and replace placeholders yourself
  const promptTemplate = await readFile("./dist/system-prompt.txt", "utf8");
  const systemPrompt = promptTemplate.replace("{{session_context}}", "cwd=/workspace");

  // 2) Create a normal session (tools/model wiring still comes from pi-mono)
  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
  });

  // 3) Force-inject system prompt directly into underlying Agent state
  //    This bypasses pi-mono's buildSystemPrompt() assembly path for this turn.
  session.agent.setSystemPrompt(systemPrompt);

  // 4) Call Agent directly instead of session.prompt(), so no prompt-template expansion
  //    or session-layer prompt rewriting is applied.
  await session.agent.prompt([
    {
      role: "user",
      content: [{ type: "text", text: "List available skills." }],
      timestamp: Date.now(),
    },
  ]);

  await session.agent.waitForIdle();
  session.dispose();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

This approach is the most direct injection path in pi-mono: prompt generation is done externally, and pi-mono is used only as the execution loop/tool runtime.
