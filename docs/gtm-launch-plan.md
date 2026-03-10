# GTM Launch Plan

> agent-bundle v1 launch strategy — maximize GitHub stars and community adoption.

---

## Current State Assessment

### What We Have (Ready to Ship)

| Asset | Status | Notes |
|---|---|---|
| Core CLI (`dev` / `build` / `serve` / `deploy`) | Done | Stable, tested |
| WebUI with live sandbox view | Done | File tree + terminal + chat |
| E2B + Kubernetes sandbox providers | Done | Both work end-to-end |
| Typed codegen (`generate`) | Done | Prisma-style, compile-time checked |
| OpenAI-compatible API (`/v1/responses`) | Done | Drop-in replacement |
| Multi-provider LLM (Anthropic, OpenAI, Gemini, Ollama, OpenRouter) | Done | YAML one-liner swap |
| MCP server integration | Done | Token-scoped, sandbox transport |
| AWS ECS Fargate deploy (beta) | Done | `deploy --target aws` |
| Session recovery | Done | Resume from last state |
| OpenTelemetry observability | Done | Tracing + metrics |
| 6 working demos | Done | See below |
| CI + Codecov + pre-commit gates | Done | Quality enforced |
| README + Configuration docs | Done | Published |
| Website (agent-bundle.com) | Done | Landing page live |

### Existing Demos

| Demo | What It Demonstrates |
|---|---|
| `code-formatter/e2b` | Config-only agent with E2B sandbox |
| `code-formatter/k8s` | Config-only agent with K8s sandbox |
| `financial-plugin` | Plugins + custom commands |
| `data-analyst-e2b` | WebUI dev mode with data analysis |
| `personalized-recommend` | `generate` + custom server + MCP integration |
| `observability-demo` | OpenTelemetry tracing & metrics |

### What We Don't Have (Not Doing for v1)

The previous GTM research doc proposed 10 polished cookbook demos, Gitpod one-click links, terminal GIF recordings, a separate cookbook repo, and a 4-week phased release cadence. None of this is built. We are launching without it.

This plan works with what exists today.

---

## Core Positioning

### One-liner

> Define skills in YAML. Develop with a live sandbox UI. Ship as a typed TypeScript package.

### Differentiation (What Nobody Else Has)

1. **Dev-to-prod pipeline** — No competing framework demos "YAML config → typed codegen → Docker image → production API" end-to-end. They all stop at "build."
2. **Live sandbox view** — WebUI shows agent's file tree + terminal in real time. No black boxes.
3. **Dev-prod parity** — Same sandbox runtime in `dev`, `serve`, and `build`. What passes locally ships as-is.
4. **Config-as-code** — Entire agent definition is a single YAML file. Version it, diff it, review it.
5. **No vendor lock-in** — Swap LLM provider or sandbox backend with one line change.

These five points must appear in every piece of launch content. They answer "why not just use LangChain / CrewAI / n8n?"

---

## Launch Channels

### Primary: Show HN

**Why**: Technical audience, high-quality discussion, direct path to stars. Every major agent framework launched here.

**Post format**:

```
Show HN: Agent Bundle – Define agent skills in YAML, develop with a live sandbox UI, ship as typed TypeScript

We built a CLI tool for shipping AI agent skills to production.

The problem: agent skills work great inside local coding agents (Claude Code,
Cline, etc). Deploying them to production means rewriting everything.

agent-bundle closes that gap:

1. Define your agent in a YAML file (model, sandbox, skills)
2. `npx agent-bundle dev` — live WebUI showing file tree + terminal in real time
3. `npx agent-bundle build` — typed TypeScript factory + Docker image
4. `npx agent-bundle serve` — OpenAI-compatible API endpoint

One YAML config, same sandbox in dev and prod, no vendor lock-in (Anthropic /
OpenAI / Gemini / Ollama), E2B or Kubernetes sandboxes.

Repo: https://github.com/yujiachen-y/agent-bundle
Website: https://agent-bundle.com
```

**Timing**: Weekday, 8-10am ET (peak HN traffic).

**Key rules**:
- Be honest about what it does and doesn't do
- Respond to every comment in the first 2 hours
- Don't use marketing language; be technical and direct
- Acknowledge limitations upfront (beta deploy, no GCP yet)

### Secondary: Twitter/X

**Post 1 — Launch thread** (pin this):
- Tweet 1: One-liner + repo link + architecture diagram
- Tweet 2: 30-second screen recording of `npx agent-bundle dev` (WebUI in action)
- Tweet 3: The 3-command pipeline (YAML → build → serve → curl)
- Tweet 4: "Supports Anthropic, OpenAI, Gemini, Ollama, OpenRouter — swap with one line of YAML"
- Tweet 5: Link to Show HN post

**Post 2 — The "no rewrite" angle**:
> Every agent framework demos "build." None of them demo "deploy to production without rewriting."
>
> agent-bundle: one YAML file → typed TypeScript → Docker image → OpenAI-compatible API.
>
> Same sandbox in dev and prod. {link}

**Post 3 — The WebUI angle** (with screen recording):
> Most agent frameworks are black boxes. You send a message and hope for the best.
>
> npx agent-bundle dev gives you a live view of the agent's file tree and terminal. You see exactly what it's doing inside the sandbox.

### Tertiary: Reddit

- **r/programming** — Technical post, "I built" framing, focus on the typed codegen and dev-prod parity
- **r/typescript** — Focus on Prisma-style typed codegen, ESM-only, compile-time variable checking
- **r/artificial** — Focus on sandbox security and multi-provider support
- **r/devops** — Focus on the deploy pipeline and config-as-code

### Dev.to / Blog

One long-form tutorial post: "From YAML to Production Agent API in 5 Minutes" — step-by-step walkthrough using the `code-formatter` demo.

---

## Star-Driving Tactics

### README Optimization

The current README is solid but can be improved for conversion:

1. **Add a screen recording / GIF** at the top showing the WebUI in action. This is the single highest-ROI change. Every framework with 10k+ stars has a visual demo in their README.
2. **Add a "Try it now" section** with a one-command setup using an existing demo:
   ```bash
   git clone https://github.com/yujiachen-y/agent-bundle.git
   cd agent-bundle/demo/data-analyst-e2b
   ./setup.sh
   ```
3. **Add demo gallery links** pointing to `demo/README.md` from the main README.
4. **Add a "Comparison" section** — a 3-row table comparing agent-bundle to the "stitch it together yourself" approach. Keep it factual, not marketing.

### Low-Effort, High-Impact Actions

| Action | Effort | Impact | Notes |
|---|---|---|---|
| Record a 30s WebUI screen recording, add to README | 1 hour | Very high | #1 priority — visual proof |
| Add "Open in GitHub Codespaces" button | 2 hours | High | Free tier, no signup friction |
| Add social preview image (`og:image`) to repo | 30 min | Medium | Shows up in link previews everywhere |
| Add topic tags to GitHub repo | 5 min | Medium | `ai-agent`, `typescript`, `sandbox`, `cli`, `yaml` |
| Pin issues for "good first issue" | 30 min | Medium | Signals active community |
| Create a GitHub Discussion category | 15 min | Low-medium | "Show and Tell" for community demos |

### Things NOT Worth Doing for v1

- Gitpod one-click (requires maintaining a separate config; GitHub Codespaces is simpler)
- Separate cookbook repo (existing `demo/` directory is sufficient)
- 4-week phased release (ship everything at once, iterate based on feedback)
- Polished marketing videos (screen recordings are enough)
- Product Hunt launch (save for v1.1 when we have more demos)

---

## Content Calendar (Launch Week)

| Day | Channel | Content |
|---|---|---|
| Mon | GitHub | Finalize README (GIF, "try it now", Codespaces button, topic tags, social preview) |
| Tue AM | Hacker News | Show HN post (8-10am ET) |
| Tue AM | Twitter/X | Launch thread (immediately after HN) |
| Tue PM | Reddit | r/programming + r/typescript posts |
| Wed | Twitter/X | WebUI screen recording post |
| Thu | Dev.to | Long-form tutorial ("YAML to Production in 5 Minutes") |
| Fri | Twitter/X | "No vendor lock-in" angle post |
| Following week | Reddit | r/artificial + r/devops posts (stagger to avoid spam) |

---

## Success Metrics

| Metric | Target (Week 1) | Stretch (Month 1) |
|---|---|---|
| GitHub Stars | 200 | 1,000 |
| HN Points | 50 | — |
| HN Comments | 20 | — |
| Twitter Impressions | 10k | 50k |
| Demo clones/forks | 20 | 100 |

---

## Pre-Launch Checklist

- [ ] Record 30-second WebUI screen recording (GIF or MP4)
- [ ] Add screen recording to README hero section
- [ ] Add "Try it now" section to README with demo one-liner
- [ ] Add GitHub Codespaces config (`.devcontainer/devcontainer.json`)
- [ ] Add "Open in Codespaces" button to README
- [ ] Set GitHub repo social preview image
- [ ] Add GitHub topic tags (`ai-agent`, `typescript`, `sandbox`, `cli`, `yaml`, `mcp`)
- [ ] Pin 2-3 "good first issue" issues
- [ ] Create "Show and Tell" GitHub Discussion category
- [ ] Verify all 6 demos run cleanly with `./setup.sh`
- [ ] Draft Show HN post text
- [ ] Draft Twitter launch thread
- [ ] Draft r/programming post
- [ ] Prepare Dev.to tutorial draft

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| "Just another agent framework" perception | Lead with the dev-to-prod pipeline — nobody else has this. Never position as "yet another LLM wrapper." |
| HN skepticism about AI tools | Be technical and honest. Show the YAML → TypeScript → Docker pipeline, not chatbot screenshots. Acknowledge what's beta. |
| Demo setup fails for users | Verify all `setup.sh` scripts. Add prerequisite checks (Node version, Docker, API keys). |
| Low initial traction | Engage genuinely in HN comments. Cross-post to niche subreddits over the following weeks. Don't spam. |
| Negative comparison to LangChain/CrewAI | Don't compare directly. Focus on what we do that they don't (sandbox view, typed codegen, deploy pipeline). |

---

## Post-Launch Demo Roadmap

Prior market research (15 market segments, 18+ competing frameworks, viral content analysis) scored 10 demo concepts across buzz, impact, reproducibility, differentiation, and shareability.

**Hard rule**: Every demo must be built on high-quality, popular skills from [skills.sh](https://skills.sh). This constraint serves two purposes — it ensures demo quality, and it showcases agent-bundle's value as an open-skill bundling platform. If a demo concept has no strong skill on skills.sh, we don't build it.

### Skills.sh Audit Results

| Demo Concept | Best Available Skill(s) | Installs | Owner | Verdict |
|---|---|---|---|---|
| `pdf-to-deck` | `pdf` + `pptx` + `theme-factory` | 24.2K + 20.3K + 9.9K | `anthropics/skills` | **BUILD** — Anthropic official, top-tier installs |
| `pr-doctor` | `requesting-code-review` + `receiving-code-review` | 13.8K + 11.1K | `obra/superpowers` | **BUILD** — 64.6K repo stars, proven methodology |
| `screenshot-to-app` | `frontend-design` + `web-artifacts-builder` | 108.8K + 9.6K | `anthropics/skills` | **BUILD** — #5 globally, 108.8K installs |
| `security-suite` | `audit-website` | 28.9K | `squirrelscan/skills` | **DEFER** — No SAST/Trivy skill exists; audit-website is web-only, not sandbox escape testing |
| `data-analyst` | `xlsx` + `python-executor` | 17.8K + 7.0K | `anthropics/skills` + `inference-sh-9/skills` | **ALREADY EXISTS** — `data-analyst-e2b` demo covers this |
| `web-scraper` | `firecrawl` | 6.9K | `firecrawl/cli` | **MAYBE** — Decent skill, but crowded space |
| `sql-analyst` | `supabase-postgres-best-practices` | 25.8K | `supabase/agent-skills` | **SKIP** — No text-to-SQL skill; Supabase skill is best-practices, not NL→SQL |
| `api-test-gen` | `openapi-spec-generation` + `webapp-testing` | 2.7K + 16.1K | `wshobson/agents` + `anthropics/skills` | **SKIP** — openapi-spec-generation is too low installs for a flagship |
| `open-source-launch-pack` | `release-skills` | 5.6K | `jimliu/baoyu-skills` | **SKIP** — Moderate installs, not a strong showcase |

### Priority 1: `pdf-to-deck` — "PDF to Presentation Deck in 60 Seconds"

> Turn any PDF into a polished slide deck — structure extracted, visuals generated, speaker notes written. All in a sandbox.

- **Score**: 92/100 (highest overall)
- **Why build this**: Visual before/after contrast (raw PDF → polished PPTX) is the most shareable format on social media. Reaches non-developer audiences (PMs, consultants, students), expanding beyond the developer bubble.
- **skills.sh skills**:
  - [`pdf`](https://skills.sh) from `anthropics/skills` (24.2K installs) — extract structure, tables, figures from PDF
  - [`pptx`](https://skills.sh) from `anthropics/skills` (20.3K installs) — create/edit PPTX with PptxGenJS, design guidance
  - [`theme-factory`](https://skills.sh) from `anthropics/skills` (9.9K installs) — 10 professional font/color themes
- **Sandbox**: Python 3.12 + pdfplumber + python-pptx + Pillow (or Node.js + PptxGenJS per skill spec)
- **Channel**: Twitter video (30s before/after), LinkedIn (enterprise appeal)
- **Why these skills**: All three from Anthropic's official skill repo (78.5K GitHub stars). The `pdf` + `pptx` combo is the natural pipeline. `theme-factory` adds visual polish that differentiates from ugly auto-generated decks.

### Priority 2: `pr-doctor` — "One-Click PR Health Check"

> Turn any PR into merge-ready: automated review + structured feedback + applicable patch — multi-skill pipeline in one agent.

- **Score**: 90/100
- **Why build this**: PR review is the largest developer audience pain point. Demonstrates multi-skill pipeline — best showcase for agent-bundle's skill composability. Hits the most active communities (r/programming, HN).
- **skills.sh skills**:
  - [`requesting-code-review`](https://skills.sh) from `obra/superpowers` (13.8K installs) — dispatches code-reviewer subagent, structured severity feedback
  - [`receiving-code-review`](https://skills.sh) from `obra/superpowers` (11.1K installs) — processes review feedback, generates fixes
  - [`test-driven-development`](https://skills.sh) from `obra/superpowers` (15.6K installs) — ensures fixes include tests
- **Sandbox**: Node.js + git
- **Channel**: Show HN + technical blog post, r/programming
- **Why these skills**: All from `obra/superpowers` (64.6K repo stars) — the second most popular skill repo on skills.sh. The review→fix→test pipeline is a natural multi-skill demo. Dropped the Semgrep/Trivy angle since no quality SAST/vuln skills exist on skills.sh.

### Priority 3: `screenshot-to-app` — "Screenshot to Running React App in 90 Seconds"

> Give it a screenshot. Get back a built, tested, running React app — not just code, but a working build.

- **Score**: 86/100
- **Why build this**: `frontend-design` is the #5 most installed skill globally (108.8K). This is the strongest signal that the audience exists. screenshot-to-code (71.5K GitHub stars) only generates code but does not verify it builds and runs — our sandbox closes that gap.
- **skills.sh skills**:
  - [`frontend-design`](https://skills.sh) from `anthropics/skills` (108.8K installs) — production-grade frontend with bold design choices, React/Tailwind/shadcn
  - [`web-artifacts-builder`](https://skills.sh) from `anthropics/skills` (9.6K installs) — React 18 + TypeScript + Vite + Tailwind + shadcn artifact generation
- **Sandbox**: Node.js 20 + npm + Vite + React + Tailwind CSS
- **Channel**: Twitter video (90s screenshot → build success), r/webdev, r/reactjs
- **Why these skills**: `frontend-design` at 108.8K installs is the strongest demand signal on the entire platform. Combined with sandbox build verification ("it actually compiles"), this is a uniquely compelling demo no competitor offers.

### Deferred / Skipped

| Demo | Reason |
|---|---|
| `security-suite` | No quality SAST (Semgrep) or vuln scanner (Trivy) skills on skills.sh. `audit-website` (28.9K) is web audit only, doesn't match our sandbox escape narrative. Revisit if security skills appear on skills.sh. |
| `sql-analyst` | No text-to-SQL skill exists. `supabase-postgres-best-practices` is about optimization, not NL→SQL generation. |
| `api-test-gen` | `openapi-spec-generation` has only 2.7K installs — not flagship quality. |
| `open-source-launch-pack` | `release-skills` (5.6K) and `crafting-effective-readmes` (550) are too niche. |
| `web-scraper` | `firecrawl` (6.9K) is decent but the scraping space is crowded. Could build later if demand emerges. |

### Demo Build Principles

Each new demo must:

1. Use **at least one skill with 10K+ installs** from skills.sh as its primary skill
2. Self-contained directory with its own `package.json`, `setup.sh`, `README.md`
3. One-command setup (`./setup.sh`)
4. 15-second screen recording at the top of its README
5. Both CLI (`npx agent-bundle dev`) and API (`curl POST /v1/responses`) entry points
6. Fixed sample inputs in the repo for reproducibility

---

## Post-Launch Iteration

Based on community feedback after Week 1:

1. **Build the most-requested demo first** — Let HN/Reddit comments and GitHub issues decide the order within the roadmap above
2. **Documentation gaps** — Whatever questions come up repeatedly, turn into docs
3. **Integration guides** — If people ask "how do I use this with X?", write the guide
4. **Product Hunt** — Save for when we have 500+ stars and a polished visual story
