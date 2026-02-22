---
doc_sync_id: "b5ae9f87-f9a4-4dda-90f2-50788324a191"
---

# GTM Demo Strategy

> Research report for agent-bundle v1 launch — identifying high-impact demo scenarios to maximize GitHub stars and community adoption.
>
> Based on independent research across 15 market segments, 18+ competing frameworks, viral social media content, and cross-validated against a separate ChatGPT deep-research report covering 40+ candidate skills with quantitative scoring.

---

## Executive Summary

Four core findings emerged from the combined research:

1. **Sandboxed code execution** is agent-bundle's strongest differentiator. The top 3 high-demand categories (data analysis, code generation, web scraping) all inherently depend on sandbox execution.
2. **The biggest gap across all competitors** is the dev-to-prod deployment story, sandbox security visualization, and config-as-code — exactly what agent-bundle is built for.
3. **Viral demos share common traits**: concrete, quantifiable outcomes (not abstract capabilities), real business tasks, 15-second GIF/short video format, and open-source reproducibility.
4. **High-visual-output demos** (PPTX, charts, working builds) generate disproportionate social sharing compared to text-only outputs.

We recommend building **10 demos** in three tiers: **4 flagship demos** (maximize reach) + **4 industry scenario demos** (cover high-demand verticals) + **2 platform feature demos** (showcase unique capabilities).

---

## Scoring Model

Each demo is evaluated across five dimensions (0-100 total):

| Dimension | Weight | What It Measures |
|---|---|---|
| **Buzz** | 0-25 | Does it hit a topic with high discussion volume in the past 12 months? (stars, media, community) |
| **Impact** | 0-25 | Can it produce a "screenshot-worthy" result in 30-120 seconds? (PPTX, patch, chart, website) |
| **Reproducibility** | 0-20 | Can someone run it with one command + minimal env vars? Are dependencies containerizable? |
| **Differentiation** | 0-15 | Does it showcase agent-bundle's unique capabilities (YAML config, sandbox, typed codegen, MCP)? |
| **Shareability** | 0-15 | Is it suitable for GitHub README, GIF, HN/Reddit title, short video, or template repo? |

---

## Market Signals

| Category | Trend | Sandbox Fit | Key Projects (Stars) |
|---|---|---|---|
| Data Analysis & Viz | Hot | Very High | PandasAI (23k), Wren AI (14.5k) |
| Code Gen & Transform | Hot | Very High | Claude Code (55k), aider (32k), Cline (58k), OpenHands (68k) |
| Web Scraping | Hot | Very High | Crawl4AI (58k), Firecrawl (40k) |
| Security Scanning | Hot | High | Semgrep (14k), Trivy (32k), Gitleaks (25k) |
| Design-to-Code | Hot | High | screenshot-to-code (71.5k) |
| Database Ops | Hot | High | Vanna (23k), Wren AI (14.5k) |
| DevOps Automation | Hot | High | n8n (176k), K8sGPT (7.4k) |
| Document Processing | Hot | Medium | Documind, Docling, Skills repo (73k) |
| API Testing | Warm | High | Keploy, EvoMaster |
| Content & Office Docs | Hot | Medium | Official Agent Skills (73k): pptx-builder, xlsx-analyst, pdf-processing |

Categories ranked "Very High" in sandbox fit share a critical property: the agent generates code that **must be executed in an isolated environment**. This is exactly what agent-bundle provides. These categories also produce visible, tangible outputs (charts, working code, structured data) that make for compelling demos.

---

## Competitive Gap Analysis

| Gap | Description | agent-bundle Advantage |
|---|---|---|
| **Dev → Prod deployment** | Nearly all frameworks demo "build" but not "deploy & operate" | `build` generates typed factory + Docker image |
| **Sandbox security visualization** | E2B demos sandbox execution but nobody showcases the security/isolation story | WebUI with live file tree + terminal output |
| **Config-as-Code** | No framework demos YAML config versioning, diffing, or rollback | Entire workflow is YAML-driven |
| **MCP data access control** | MCP is becoming standard but demos are sparse | Token-scoped MCP is a core design pillar |
| **Multi-tenant isolation** | Enterprise buyers care deeply but no framework demos this | One sandbox per session by design |
| **Skill supply chain security** | Agent skill ecosystems are a new attack surface (OpenClaw malicious skills, Cline supply chain incidents) | Sandbox isolation + skill auditing |

### Competitor Landscape

| Framework | Stars | Demo Format | Top Demo |
|---|---|---|---|
| n8n | 176k | Visual workflow builder, templates marketplace | AI workflow automation |
| Dify | 130k | Drag-and-drop UI, plugin marketplace | Visual agentic workflow with RAG |
| LangChain | 127k | Jupyter notebooks, LangChain Academy | RAG agent, Open Deep Research |
| Open Interpreter | 62k | Terminal GIFs, CLI recordings | OS-control agent |
| AutoGen | 55k | No-code GUI (AutoGen Studio), gallery | Multi-agent workflows |
| Flowise | 49k | Visual node editor, template gallery | Drag-and-drop chatbot with RAG |
| CrewAI | 44k | Python scripts, YAML configs, examples repo | Stock Analysis crew |
| Semantic Kernel | 27k | In-repo samples (C#/Python/Java) | Multi-agent NL-to-SQL |
| Composio | 27k | Python/TS quickstarts | HackerNews agent, PR reviewer |
| Haystack | 24k | Jupyter cookbook | GitHub Issue Resolver |
| Vercel AI SDK | 22k | Vercel templates, live deployable demos | ai-chatbot (Next.js) |
| Mastra | 21k | Docs examples, interactive playground | TypeScript agent in 5 minutes |
| E2B | 11k | Cookbook repo, framework integrations | Code interpreter sandbox |

### Key Lessons from Competitors

- **Visual matters**: The top 3 by stars (n8n, Dify, Flowise) all have visual drag-and-drop interfaces. Demos with strong visual output dramatically outperform text-only results.
- **Minimalism sells**: CrewAI grew from 0 to 44k stars with the "build an agent in 10 lines" pitch.
- **Relatable use cases beat abstract demos**: Stock analysis, email automation, and chat-with-PDF outperform "HaikuBot."
- **Separate examples repos work**: CrewAI's examples repo has 5.5k stars on its own.
- **Terminal GIFs are cheap and shareable**: Every Open Interpreter demo starts with a 15-second recording.
- **Over-represented categories to avoid leading with**: RAG chatbot, simple chatbot UI, stock analysis — table stakes, not differentiators.

---

## Viral Pattern Insights

Based on analysis of viral agent demos (OpenClaw 180k stars, Boris Cherny's tweet with 4.4M views, Manus AI 200k+ views in 20 hours):

1. **Concrete numbers** — "259 PRs, 497 commits, 30 days" is 100x more powerful than "AI writes code"
2. **Real tasks** — Sorting resumes, managing email, building complete apps — not toy examples
3. **GIF/short video** — Twitter: 30-60s video; Reddit/HN: technical long-form post
4. **Provocative framing** — "every line by AI", "$10K in 7 hours" triggers both excitement and skepticism
5. **Open-source reproducibility** — The most viral projects (OpenClaw, Browser Use, DeepSeek) are all open-source
6. **Before/after visuals** — Input PDF vs output PPTX, raw CSV vs generated chart — the contrast drives shares

### Audience Breakdown

| Audience | Platform | What They Care About |
|---|---|---|
| Software developers | Twitter/X, HN, Reddit | Reliability, pricing, open-source, workflow integration |
| Non-technical builders | YouTube, Product Hunt | Simplicity, visual results, low cost |
| Business leaders | LinkedIn, Twitter/X | ROI claims, team productivity, enterprise adoption |
| Security practitioners | HN, Twitter/X | Prompt injection, governance, audit trails |

---

## Demo Portfolio

### Tier 1: Flagship Demos (maximize reach, build first)

#### Demo 1: `yaml-to-prod` — "From YAML to Production API in 3 Minutes"

> One YAML file. Three commands. A production-ready agent API with typed TypeScript, Docker image, and OpenAI-compatible endpoint.

- **Score**: 89/100 (Buzz: 20, Impact: 22, Reproducibility: 20, Differentiation: 15, Shareability: 12)
- **Target audience**: Platform engineers, DevOps, technical founders
- **Pain point**: Every competitor demos "build" but not "deploy & operate." The gap from demo to production is enormous. No competing framework has this demo.
- **Skills**:
  - `echo-skill`: Simplest possible echo skill (focus is on platform capabilities, not skill complexity)
- **Sandbox setup**: Minimal base image
- **User flow**:
  1. Show a 10-line YAML file
  2. `agent-bundle generate` → show generated typed TypeScript factory
  3. `agent-bundle build` → show Docker image build
  4. Run service → `curl POST /v1/responses` → get response
  5. Connect with OpenAI Python SDK (override `base_url`) → works seamlessly
- **Artifacts**: `dist/<name>/index.ts`, `types.ts`, `bundle.json`, Docker image
- **Visual appeal**: Complete pipeline from YAML to curl response, each step clearly shown in terminal
- **Risk**: Must ensure the entire pipeline is rock-solid; any failure in the "3 minute" claim destroys credibility
- **Viral potential**: High. "3 minutes to production" is a clear, quantifiable narrative. Fills the biggest gap across all competitors.
- **Search keywords**: "deploy AI agent", "agent to production", "agent framework deployment", "agent service API"

---

#### Demo 2: `data-analyst` — "Talk to Your CSV"

> Drop a CSV, ask questions in plain English, get charts and a presentation — all running in an isolated sandbox.

- **Score**: 91/100 (Buzz: 24, Impact: 24, Reproducibility: 18, Differentiation: 12, Shareability: 13)
- **Target audience**: Data analysts, product managers, full-stack developers
- **Pain point**: Non-technical users cannot self-serve analytics; data scientists spend 60-80% of time on data cleaning and exploration
- **Skills**:
  - `analyze-data`: Receives natural language question → generates pandas/matplotlib code → executes in sandbox → returns charts and statistics
  - `clean-data`: Detects data quality issues (missing values, type errors) → generates cleaning script → executes
  - `build-report` (optional): Compiles analysis results into a summary PPTX/XLSX for presentation
- **Sandbox setup**: Python 3.12 + pandas + matplotlib + seaborn + scipy + python-pptx + openpyxl
- **User flow**:
  1. `preMount` uploads CSV to `/workspace/data.csv`
  2. User: "What are the top 5 products by revenue? Show me a bar chart"
  3. Agent generates Python script → writes to sandbox → executes → reads chart output
  4. WebUI shows: files appearing in tree (`analysis.py`, `chart.png`); terminal scrolling pandas output
  5. Optionally generates `report.pptx` with charts embedded
- **Artifacts**: `generate/analysis.py`, `generate/chart.png`, `generate/metrics.xlsx`, `generate/report.pptx`
- **Visual appeal**: Files dynamically appearing in WebUI file tree, terminal scrolling Python output, chart files generated, PPTX slides with embedded charts
- **Risk**: Hallucination in statistical conclusions; mitigate by using code execution (not LLM text) for all numbers
- **Viral potential**: Very high. "Talk to your data" is the most universally relatable AI demo. PandasAI's 23k stars prove the demand. Non-technical audiences can immediately understand the value.
- **Search keywords**: "AI data analysis", "chat with CSV", "natural language data query", "AI visualization"

---

#### Demo 3: `pdf-to-deck` — "PDF to Presentation Deck in 60 Seconds"

> Turn any PDF into a polished slide deck — structure extracted, visuals generated, speaker notes written. All in a sandbox.

- **Score**: 92/100 (Buzz: 23, Impact: 25, Reproducibility: 19, Differentiation: 12, Shareability: 13)
- **Target audience**: Product managers, consultants, marketing teams, students
- **Pain point**: Manually turning reports/papers into presentations is tedious; existing tools generate ugly or inaccurate slides
- **Skills**:
  - `pdf-processing`: Extracts structure, key sections, tables, and figures from PDF → outputs `outline.json` + `notes.md`
  - `pptx-builder`: Assembles outline + notes + visuals into a PPTX (title slide, key points, conclusion, Q&A)
  - `canvas-design` (optional): Generates cover image and key visuals (PNG) based on theme and key figures
- **Sandbox setup**: Python 3.12 + pdfplumber + python-pptx + Pillow
- **User flow**:
  1. `preMount` uploads PDF to `/workspace/input.pdf`
  2. Agent extracts structure and key content from PDF
  3. Generates speaker notes and visual descriptions
  4. Assembles PPTX with proper layout, formatting, and embedded visuals
  5. Returns download-ready file
- **Artifacts**: `generate/outline.json`, `generate/notes.md`, `generate/cover.png`, `generate/slides.pptx`
- **Visual appeal**: Extremely strong. Before/after contrast (raw PDF vs polished deck) is naturally shareable. PPTX screenshots are eye-catching on social media.
- **Risk**: PDF structure variance (different formats, scanned vs native); mitigate with curated example PDFs and clear "supported/unsupported" boundaries in README. Example PDF must have clear redistribution license.
- **Viral potential**: Very high. The before/after visual is a natural social media format. Strong appeal to non-developer audiences (PMs, consultants, students), expanding reach beyond the usual developer bubble.
- **Search keywords**: "PDF to PowerPoint AI", "AI presentation generator", "document to slides", "AI PPTX"

---

#### Demo 4: `pr-doctor` — "One-Click PR Health Check"

> Turn any PR into merge-ready: automated review + security scan + applicable patch — multi-skill pipeline in one agent.

- **Score**: 90/100 (Buzz: 24, Impact: 23, Reproducibility: 17, Differentiation: 13, Shareability: 13)
- **Target audience**: Software engineers, tech leads, open-source maintainers
- **Pain point**: PR review is the biggest bottleneck in developer workflows; security checks are often skipped; AI review tools hallucinate without running actual tools
- **Skills**:
  - `pr-review`: Reads PR diff → outputs review report with risk points, code smells, and priority ranking
  - `pr-improve`: Generates applicable patch file (`fix.patch`) with suggested improvements
  - `sast-semgrep`: Runs Semgrep rule set against the code → outputs `file:line` findings
  - `vuln-scan`: Runs Trivy directory scan → outputs vulnerability list with severity
- **Sandbox setup**: Python + Node.js + Semgrep + Trivy + git
- **MCP integration**: Optionally connects to GitHub MCP server to pull PR diffs directly
- **User flow**:
  1. Agent reads repo and generates diff (or reads provided patch)
  2. Runs `pr-review` → outputs review report (risk points, code smells, priority)
  3. Runs `sast-semgrep` → outputs file:line security findings
  4. Runs `vuln-scan` → outputs dependency/container vulnerabilities
  5. Runs `pr-improve` → generates applicable patch + test command suggestions
  6. Outputs merge-readiness checklist: risk items, manual-review items, suggested commit message
- **Artifacts**: `generate/pr-review.md`, `generate/security.md`, `generate/fix.patch`, `generate/checklist.md`
- **Visual appeal**: Terminal scrolling live scan output; file tree showing reports appearing one by one; patch diff display
- **Risk**: Model cost per review (limit token usage); scan tool output variance (normalize reports); never auto-execute unknown scripts — whitelist Bash commands
- **Viral potential**: Very high. PR review is the largest developer audience pain point. The "input diff → output patch" narrative is clear and actionable. Multi-skill pipeline showcases agent-bundle's composability better than any single-skill demo.
- **Search keywords**: "AI code review", "automated PR review", "AI security audit", "code vulnerability scanner"

---

### Tier 2: Industry Scenario Demos (cover high-demand verticals)

#### Demo 5: `screenshot-to-app` — "Screenshot to Running React App in 90 Seconds"

> Give it a screenshot. Get back a built, tested, running React app — not just code, but a working build.

- **Score**: 86/100 (Buzz: 23, Impact: 24, Reproducibility: 16, Differentiation: 12, Shareability: 11)
- **Target audience**: Frontend developers, designers, product managers
- **Pain point**: screenshot-to-code (71.5k stars) only generates code but does not verify it builds and runs
- **Skills**:
  - `design-to-code`: Analyzes screenshot → generates React + Tailwind component code
  - `build-and-test`: Runs `npm install && npm run build` in sandbox → verifies no errors
  - `iterate-on-feedback`: User feedback → modifies code → rebuilds and verifies
- **Sandbox setup**: Node.js 20 + npm + Vite + React + Tailwind CSS
- **User flow**:
  1. `preMount` uploads UI screenshot
  2. Agent analyzes screenshot → generates React project structure → writes to sandbox
  3. Runs `npm install && npm run build` → auto-fixes on failure → retries
  4. Returns complete project code on successful build
- **Artifacts**: Full React project in `generate/app/`, build output in `generate/dist/`
- **Visual appeal**: Extremely strong. Project structure appearing file-by-file in WebUI tree (`src/`, `components/`, `App.tsx`...); terminal showing Vite build process.
- **Viral potential**: Very high. "Not just code — a working build" differentiates from screenshot-to-code's 71.5k star audience.
- **Search keywords**: "screenshot to code", "design to code AI", "UI to React", "figma to code"

---

#### Demo 6: `sql-analyst` — "Ask Your Database in English"

> Natural language → SQL → execute in a sandboxed database → formatted results. Zero risk to production data.

- **Score**: 77/100 (Buzz: 22, Impact: 20, Reproducibility: 15, Differentiation: 10, Shareability: 10)
- **Target audience**: Business analysts, backend developers, data teams
- **Pain point**: Analysts cannot write SQL; running AI-generated SQL against production databases is risky
- **Skills**:
  - `text-to-sql`: Understands natural language question → generates SQL → executes in sandboxed SQLite/Postgres → returns formatted results
  - `sql-explain-fix`: If query fails, explains the error and auto-corrects
  - `visualize-results`: Converts query results to charts and XLSX
- **Sandbox setup**: Python + SQLite + PostgreSQL client + matplotlib + openpyxl
- **MCP integration**: Connects to DBHub via MCP to read schema metadata (read-only, token-scoped)
- **Artifacts**: `generate/query.sql`, `generate/result.xlsx`, `generate/chart.png`
- **Viral potential**: High. Vanna has 23k stars. Sandbox SQL execution = "zero risk to production" is a unique selling point.
- **Search keywords**: "text to SQL", "AI database query", "natural language SQL", "chat with database"

---

#### Demo 7: `web-scraper` — "Structured Data from Any Website"

> Point it at a URL, describe what you want, get clean JSON — scraping scripts run safely in a sandbox.

- **Score**: 78/100 (Buzz: 23, Impact: 20, Reproducibility: 14, Differentiation: 10, Shareability: 11)
- **Target audience**: Growth hackers, data engineers, market researchers
- **Pain point**: Traditional scrapers break when websites change; AI can understand pages semantically but needs a safe execution environment
- **Skills**:
  - `scrape-page`: Receives URL + data requirement description → generates Playwright script → executes in sandbox → returns structured JSON
  - `transform-data`: Cleans, deduplicates, and reformats extracted data
- **Sandbox setup**: Node.js + Playwright + Chromium
- **Artifacts**: `generate/scraper.ts`, `generate/data.json`
- **Viral potential**: High. Crawl4AI 58k stars, Firecrawl 40k stars prove demand. Sandbox isolation = safe execution of untrusted scraping code.
- **Search keywords**: "AI web scraping", "intelligent data extraction", "LLM web crawler"

---

#### Demo 8: `api-test-gen` — "OpenAPI Spec to Full Test Suite to Green Build"

> Feed it your API spec. Get a complete test suite — written, executed, and verified in a sandbox.

- **Score**: 74/100 (Buzz: 18, Impact: 20, Reproducibility: 16, Differentiation: 10, Shareability: 10)
- **Target audience**: Backend developers, QA engineers, API teams
- **Pain point**: Developers skip writing tests; manual API testing is tedious and incomplete
- **Skills**:
  - `generate-tests`: Parses OpenAPI/Swagger spec → generates pytest/vitest test cases
  - `run-and-fix`: Runs tests in sandbox → auto-fixes failures → reruns until all green
- **Sandbox setup**: Python + pytest + requests + Node.js + vitest
- **Artifacts**: `generate/tests/`, `generate/test-report.md`
- **Viral potential**: Medium-high. API testing is a daily pain point. "From spec to green tests" is a clear before/after narrative.
- **Search keywords**: "AI API testing", "auto generate API tests", "OpenAPI test generation"

---

### Tier 3: Platform Feature Demos (showcase agent-bundle unique capabilities)

#### Demo 9: `security-suite` — "Agent Security: Sandbox Escape Test + Skill Supply Chain Guard"

> We asked an agent to break out of its sandbox. Then we scanned a skill repo for supply chain risks. Here is what happened.

This demo combines two complementary security angles into one showcase:

- **Score**: 88/100 (Buzz: 23, Impact: 22, Reproducibility: 18, Differentiation: 14, Shareability: 11)
- **Target audience**: Security engineers, platform engineers, CTOs evaluating agent safety
- **Pain point**: 80-90% of AI agent projects fail in production (RAND); prompt injection affects 73% of deployments; recent incidents (OpenClaw malicious skills, Cline supply chain attacks) highlight skill ecosystem risks

**Part A: Sandbox Escape Test**

- **Skills**:
  - `red-team-test`: Intentionally attempts file system traversal, network egress, resource exhaustion, etc.
  - `audit-report`: Collects all blocked operations and generates a security audit report
- **User flow**:
  1. Agent is instructed to attempt various "escape" operations
  2. Each attempt is blocked by the sandbox; terminal shows interception logs
  3. Final audit report generated: attempted X, blocked Y, sandbox integrity: PASS
- **Visual appeal**: Terminal showing red "BLOCKED" messages; file tree staying clean; final "SANDBOX INTEGRITY: PASS"

**Part B: Skill Supply Chain Guard**

- **Skills**:
  - `skill-supply-chain-guard`: Scans SKILL.md files and scripts for suspicious patterns (curl|bash, powershell IEX, executable downloads, shell rc modifications, ssh key access)
  - `secret-scan`: Runs Gitleaks against skills repo to detect leaked secrets
- **User flow**:
  1. Provide a curated "bad examples" skill directory (suspicious patterns, not actual malicious payloads)
  2. Static scan identifies high-risk patterns with file:line references
  3. Gitleaks checks for exposed secrets
  4. Output risk report grouped by severity (Critical/High/Medium/Low)

- **Sandbox setup**: Standard sandbox with resource limits + Gitleaks
- **Artifacts**: `generate/escape-audit.md`, `generate/skill-risk-report.md`, `generate/findings.json`
- **Risk**: Reports must emphasize "suspicious != malicious" to avoid false accusations; never provide executable attack instructions; defense perspective only
- **Viral potential**: Very high. Controversial framing + security topic + visual impact + real-world incident tie-in. "We told AI to try to escape" and "scan your skills for supply chain risks" are both natural social media headlines.
- **Search keywords**: "AI agent security", "sandbox isolation", "agent safety", "AI containment", "skill supply chain security"

---

#### Demo 10: `open-source-launch-pack` — "Ship Your Open-Source Project in 10 Minutes"

> README + CHANGELOG + contributor credits + docs site — all generated, all in one run.

- **Score**: 86/100 (Buzz: 20, Impact: 22, Reproducibility: 19, Differentiation: 12, Shareability: 13)
- **Target audience**: Open-source maintainers, indie hackers, developers preparing to publish
- **Pain point**: Launching an open-source project requires polished README, changelog, contributor credits, and docs — tedious manual work that delays shipping
- **Skills**:
  - `readme-generator`: Analyzes repo structure → generates professional README.md
  - `changelog-gen`: Parses git log → generates CHANGELOG.md (Conventional Commits format)
  - `contributors-credit`: Reads contributor list → generates all-contributors table/badges
- **Sandbox setup**: Node.js + git
- **Artifacts**: `generate/README.md`, `generate/CHANGELOG.md`, `generate/CONTRIBUTORS.md`
- **Risk**: Do not auto-modify the real repo; output as patch files for user review
- **Viral potential**: High. Directly hits the "stars growth" motivation of the target audience. Self-referential: "we used agent-bundle to prepare our own launch."
- **Search keywords**: "AI README generator", "open source launch checklist", "auto changelog", "github project setup"

---

## GTM Playbook

### Channel Strategy per Demo

| Demo | Primary Channel | Format | Communities | Tags |
|---|---|---|---|---|
| `yaml-to-prod` | **Show HN** | Terminal recording (asciinema) | HN, r/devops, r/typescript | #AgentDeployment #DevToProd |
| `data-analyst` | **Twitter thread** + YouTube | 60s GIF + 5min video | r/datascience, r/Python | #AIDataAnalysis #ChatWithData |
| `pdf-to-deck` | **Twitter video** | 30s before/after video | r/ClaudeAI, r/artificial, LinkedIn | #AIPPTX #DocumentAI |
| `pr-doctor` | **Show HN** + Blog | Technical blog + terminal GIF | HN, r/programming, r/coding | #AICodeReview #DevProductivity |
| `screenshot-to-app` | **Twitter video** | 90s video (screenshot → build success) | r/webdev, r/reactjs | #DesignToCode #VibeCoding |
| `sql-analyst` | **Twitter thread** | GIF (query → chart) | r/SQL, r/analytics | #TextToSQL #AIAnalytics |
| `web-scraper` | **Dev.to article** | Tutorial + GIF | r/webscraping, r/Python | #AIScraping #DataExtraction |
| `api-test-gen` | **Blog post** | Step-by-step tutorial | r/QualityAssurance, HN | #APITesting #TestAutomation |
| `security-suite` | **Twitter video** + Show HN | 30s provocative video | HN, r/netsec, r/MachineLearning | #AISafety #AgentSecurity |
| `open-source-launch-pack` | **Twitter thread** + Reddit | Before/after screenshots | r/opensource, r/SideProject | #OpenSource #DevTools |

### Release Cadence (4 Weeks)

| Week | Theme | Main Demo | Supporting Demo | Channel | Goal |
|---|---|---|---|---|---|
| W1 | **"One YAML"** | `yaml-to-prod` | `pdf-to-deck` | Show HN + Twitter | Establish platform narrative + visual wow |
| W2 | **"Talk to Your Data"** | `data-analyst` | `sql-analyst` | Twitter + YouTube | Most universally relatable; attract non-dev audiences |
| W3 | **"Developer Productivity"** | `pr-doctor` | `screenshot-to-app` | HN + Twitter | Capture the largest developer audience |
| W4 | **"Agent Safety & Launch"** | `security-suite` | `open-source-launch-pack` | Twitter + HN + Reddit | Controversial security topic for closing impact |

### Content Format by Platform

| Platform | Best Format | Example |
|---|---|---|
| Twitter/X | 30-60s video or screenshot thread with concrete numbers | "259 PRs, 497 commits" style stats |
| Hacker News | "Show HN" + technical blog post | Focus on architecture, trade-offs, honest limitations |
| Reddit | Text post with screenshots + "I built this" framing | r/programming, r/artificial, vertical subreddits |
| YouTube | 5-10 minute tutorial walkthrough | Hands-on demo showing real usage |
| LinkedIn | Infographic + short demo video | Enterprise-facing demos (pdf-to-deck, pr-doctor) |
| Dev.to | Long-form tutorial with code snippets | Step-by-step guides with copy-paste commands |

---

## Demo Collection: Naming and Organization

**Recommended name**: **Agent Bundle Cookbook**

This aligns with established naming conventions (E2B Cookbook, OpenAI Cookbook, Haystack Cookbook) that developers already recognize.

**Directory structure**:

```
cookbook/
├── README.md                ← gallery page with GIFs for all demos
├── yaml-to-prod/
│   ├── README.md            ← self-contained walkthrough
│   ├── agent-bundle.yaml
│   ├── skills/
│   ├── Dockerfile
│   └── setup.sh             ← one-command setup
├── data-analyst/
├── pdf-to-deck/
├── pr-doctor/
├── screenshot-to-app/
├── sql-analyst/
├── web-scraper/
├── api-test-gen/
├── security-suite/
└── open-source-launch-pack/
```

**Deliverables per demo**:

1. `agent-bundle.yaml` — bundle config referencing 2-4 skills
2. `skills/` — self-contained SKILL.md files
3. `generate/` — reproducible output artifacts
4. `setup.sh` — one-command setup script
5. `README.md` — walkthrough with terminal GIF at the top, one curl example for the API
6. `examples/` — fixed sample inputs and expected output snippets (for CI stability)

**Key principles** (learned from competitor best practices):

- Each demo is a **self-contained directory** with its own README (from Claude Agent SDK)
- Each demo has a **15-second terminal GIF** at the top of its README (from Open Interpreter)
- Each demo has a **one-command setup script** (from Vercel AI SDK templates)
- The root README is a **gallery page** with all demo GIFs side by side (from CrewAI examples)
- Every demo provides both **CLI** (`agent-bundle serve`) and **API** (`curl POST /v1/responses`) entry points (from OpenAI Cookbook)

---

## Priority Summary

| # | Demo | Score | Differentiation |
|---|---|---|---|
| 1 | `yaml-to-prod` | 89 | Very high — no competitor has this demo |
| 2 | `data-analyst` | 91 | High — sandbox execution is the killer feature |
| 3 | `pdf-to-deck` | 92 | High — visual output drives social sharing |
| 4 | `pr-doctor` | 90 | High — multi-skill pipeline, largest dev audience |
| 5 | `screenshot-to-app` | 86 | High — "verified build" beyond code generation |
| 6 | `security-suite` | 88 | Very high — no competitor has this; timely |
| 7 | `sql-analyst` | 77 | High — sandbox = zero production risk |
| 8 | `web-scraper` | 78 | Medium — crowded space but sandbox differentiates |
| 9 | `api-test-gen` | 74 | Medium — clear before/after narrative |
| 10 | `open-source-launch-pack` | 86 | Medium — directly hits stars growth motivation |

**Recommended MVP** (build first):

| Demo | Angle | Why First |
|---|---|---|
| `yaml-to-prod` | Platform capability | No competitor has this; establishes "dev-to-prod" narrative |
| `data-analyst` | Practical use case | Most universally relatable; strongest sandbox showcase |
| `pdf-to-deck` | Visual wow factor | Highest shareability; reaches non-developer audiences |
| `security-suite` (Part A only) | Security narrative | Controversial + timely; no competitor has security visualization |

These four demos cover four completely different angles and audiences, forming a minimal but compelling portfolio for the initial Show HN launch.

---

## Appendix A: Candidate Skill Long-List

The following 40+ skills were identified as viable SKILL.md candidates for agent-bundle v1. Each skill is classified by sandbox fit (High/Medium/Low) based on whether it can be implemented with Read/Write/Edit/Bash tools in an E2B/Kubernetes sandbox.

### Coding

| Skill | Description | Sandbox Fit | Reference Projects |
|---|---|---|---|
| `pr-review` | PR diff → review comments + risk list | High | PR-Agent (10.2k stars) |
| `pr-describe` | PR diff → title/summary/change breakdown | High | PR-Agent |
| `pr-improve` | PR diff → suggested patches | High | PR-Agent |
| `ai-ci-check` | Diff + custom rules → pass/fail + suggested fix | High | Cline (58.2k stars) |
| `issue-resolver` | Issue + repo → fix plan + patch | High | OpenHands (68.1k stars) |
| `terminal-pair-programming` | Repo + instruction → multi-turn edits + commits | High | Claude Code (40.8k stars) |
| `issue-to-pr` | Issue text → workflow file / fix code | High | Sweep (7.6k stars) |

### Data

| Skill | Description | Sandbox Fit | Reference Projects |
|---|---|---|---|
| `chat-with-dataframe` | CSV/Parquet → statistical conclusions/code | High | PandasAI (23.2k stars) |
| `data-viz-from-csv` | CSV → chart PNG/HTML + explanation | High | PandasAI |
| `text-to-sql` | Question + schema → SQL + result table | Medium | Vanna (22.7k stars) |
| `sql-explain-fix` | SQL + error → fixed SQL + explanation | Medium | Vanna |

### Content & Office Docs

| Skill | Description | Sandbox Fit | Reference Projects |
|---|---|---|---|
| `pdf-processing` | PDF → extract/summarize/structured markdown | High | Agent Skills (73k stars) |
| `pptx-builder` | Outline/content → .pptx | High | Agent Skills |
| `docx-writer` | Outline/content → .docx | High | Agent Skills |
| `xlsx-analyst` | CSV/metrics → .xlsx + formulas/charts | High | Agent Skills |
| `canvas-design` | Brief → PNG/PDF visual | High | Agent Skills |
| `doc-coauthoring` | Topic/audience/constraints → complete document draft | High | Agent Skills |
| `frontend-design` | Requirements → component/page code + checklist | Medium | Agent Skills |
| `algorithmic-art` | Seed/parameters → p5.js artwork + exported image | High | Agent Skills |

### Security

| Skill | Description | Sandbox Fit | Reference Projects |
|---|---|---|---|
| `vuln-scan` | Image/directory → vulnerability list + fix suggestions | High | Trivy (32.2k stars) |
| `sast-semgrep` | Repo → rule hits + file:line | High | Semgrep (14.2k stars) |
| `secret-scan` | Repo/stdin → leaked key list | High | Gitleaks (25k stars) |
| `sbom-gen` | Image/directory → SPDX/CycloneDX SBOM | High | Syft (8.4k stars) |
| `sbom-to-cve` | SBOM → CVE list + severity | High | Grype (11.6k stars) |
| `llm-redteam` | Prompt/agent → risk use cases + report | High | promptfoo (10.6k stars) |
| `skill-supply-chain-guard` | Skills directory → suspicious instructions/links report | High | Event-driven demand |

### Ops

| Skill | Description | Sandbox Fit | Reference Projects |
|---|---|---|---|
| `k8s-triage` | Error logs/YAML → root cause + fix suggestions | High | K8sGPT (7.4k stars) |
| `ansible-workflows` | Target state → playbook/role + validation commands | Medium | ansible-lightspeed (23 stars) |

### Growth & Open Source

| Skill | Description | Sandbox Fit | Reference Projects |
|---|---|---|---|
| `readme-generator` | Repo/URL → README.md | High | readme-ai (2.9k stars) |
| `changelog-gen` | Git log → CHANGELOG.md | High | git-cliff (11.4k stars) |
| `contributors-credit` | Contributors list → README badge/table | High | all-contributors (8k stars) |
| `docs-site-builder` | Markdown docs → website build artifacts | Medium | Docusaurus (63.9k stars) |
| `release-pr-bot` | Commits → release PR / version suggestion | Medium | release-please (6.5k stars) |

---

## Appendix B: Research Sources

### Market Landscape

- [PandasAI](https://github.com/sinaptik-ai/pandas-ai) — 23k stars
- [Crawl4AI](https://github.com/unclecode/crawl4ai) — 58k stars
- [Firecrawl](https://github.com/mendableai/firecrawl) — 40k stars
- [screenshot-to-code](https://github.com/abi/screenshot-to-code) — 71.5k stars
- [Vanna](https://github.com/vanna-ai/vanna) — 23k stars
- [Wren AI](https://github.com/Canner/WrenAI) — 14.5k stars
- [Semgrep](https://github.com/returntocorp/semgrep) — 14k stars
- [Trivy](https://github.com/aquasecurity/trivy) — 32k stars
- [Gitleaks](https://github.com/gitleaks/gitleaks) — 25k stars
- [Keploy](https://github.com/keploy/keploy) — open-source API testing agent
- [Claude Code](https://github.com/anthropics/claude-code) — 55k stars
- [aider](https://github.com/Aider-AI/aider) — 32k stars
- [Cline](https://github.com/cline/cline) — 58k stars
- [OpenHands](https://github.com/All-Hands-AI/OpenHands) — 68k stars
- [Open Interpreter](https://github.com/openinterpreter/open-interpreter) — 62k stars
- [PR-Agent](https://github.com/qodo-ai/pr-agent) — 10.2k stars
- [K8sGPT](https://github.com/k8sgpt-ai/k8sgpt) — 7.4k stars
- [promptfoo](https://github.com/promptfoo/promptfoo) — 10.6k stars

### Competitive Frameworks

- [n8n](https://github.com/n8n-io/n8n) — 176k stars
- [Dify](https://github.com/langgenius/dify) — 130k stars
- [LangChain](https://github.com/langchain-ai/langchain) — 127k stars
- [AutoGen](https://github.com/microsoft/autogen) — 55k stars
- [Flowise](https://github.com/FlowiseAI/Flowise) — 49k stars
- [CrewAI](https://github.com/crewAIInc/crewAI) — 44k stars
- [Semantic Kernel](https://github.com/microsoft/semantic-kernel) — 27k stars
- [Composio](https://github.com/ComposioHQ/composio) — 27k stars
- [Haystack](https://github.com/deepset-ai/haystack) — 24k stars
- [LangGraph](https://github.com/langchain-ai/langgraph) — 25k stars
- [Vercel AI SDK](https://github.com/vercel/ai) — 22k stars
- [Mastra](https://github.com/mastra-ai/mastra) — 21k stars
- [E2B](https://github.com/e2b-dev/E2B) — 11k stars
- [TaskWeaver](https://github.com/microsoft/TaskWeaver) — 6.1k stars
- [Rivet](https://github.com/Ironclad/rivet) — 4.5k stars

### Viral Demos and Social Media Trends

- [OpenClaw](https://en.wikipedia.org/wiki/OpenClaw) — 180k stars; creator acqui-hired by OpenAI
- Boris Cherny Claude Code tweet — 4.4M views, 20k likes
- Jaana Dogan (Google) Claude Code confession — major HN thread
- [Manus AI](https://en.wikipedia.org/wiki/Manus_(AI_agent)) — 200k+ views in 20 hours
- Andrej Karpathy "Vibe Coding" tweet — coined the term, 10k+ retweets
- [Lovable](https://lovable.dev) — $100M ARR in 8 months
- [Browser Use](https://github.com/browser-use/browser-use) — 21k+ stars; powered Manus AI
- [smolagents](https://github.com/huggingface/smolagents) — 3.9k stars in one week
- Anthropic "[Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)" — major HN discussion

### Industry Reports

- Deloitte: 80.5% of finance professionals believe AI tools will become standard within 5 years
- RAND: 80-90% of AI agent projects fail in production
- MIT Technology Review: Generative coding named 2026 breakthrough technology
- Stack Overflow 2025 Survey: 92% of US developers use AI coding tools daily
- Composio: Integration failures are the #1 reason agent pilots fail

### Security Incidents (Informing Demo 9)

- OpenClaw skill extensions: malicious content found in community skills (Feb 2026)
- Cline-related supply chain / prompt injection incidents (multiple reports, 2025-2026)
- AIRIA "Lethal Trifecta" framework for agent security (private data + untrusted tokens + exfiltration vectors)
