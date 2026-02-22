# agent-bundle

> Bundle skills into a single deployable agent.

*Sandboxed execution. Token-scoped data access.*

<!-- demo GIF: `agent-bundle serve` opening TUI + WebUI showing file tree and live terminal -->

Agent Skills work great inside local coding agents. Getting them into production is a different story: skills can't be published as services, logic has to be rewritten, and behavior between dev and prod diverges.

agent-bundle closes that gap. Give it a YAML config and a set of skills — it runs a local agent for development and builds a typed, embeddable TypeScript package for deployment. Same runtime, same behavior, both directions.

---

## How it works

```
bundle.yaml + skills/
       │
       ├── agent-bundle serve   →  TUI + WebUI (local dev)
       └── agent-bundle build   →  typed TypeScript factory + Docker image
```

---

## Quick Start

### 1. Install

```bash
pnpm add -g agent-bundle
```

### 2. Define your bundle

Skills can be local directories, GitHub repos, or remote URLs. See [Agent Skills](https://github.com/agent-skills/spec) for the skill format.

```yaml
# bundle.yaml
name: invoice-processor

model:
  provider: anthropic
  model: claude-sonnet-4-20250514

prompt:
  system: |
    You are an expert invoice processing assistant.
    Current user: {{user_name}}
  variables:
    - user_name

sandbox:
  provider: kubernetes   # local k3d in serve mode

skills:
  - path: ./skills/extract-line-items
  - github: acme/invoice-skills
    skill: generate-summary
  - url: https://registry.example.com/skills/ocr
    version: 1.2.0
```

### 3. Run locally

```bash
agent-bundle serve
```

Starts a TUI for interactive testing. A WebUI at `http://localhost:3000` lets you watch the agent's file tree and terminal output in real time — see exactly what it's doing inside the sandbox.

### 4. Build for deployment

```bash
agent-bundle build
```

Produces two artifacts:

```
dist/invoice-processor/
├── index.ts      ← typed agent factory
├── types.ts      ← variable types
└── bundle.json   ← config snapshot
```

Integrate into any Node.js service:

```typescript
import { InvoiceProcessor } from "./dist/invoice-processor";

const agent = await InvoiceProcessor.init({
  variables: { user_name: "Alice" },
  hooks: {
    preMount: async (io) => {
      await io.file.write("/workspace/invoice.pdf", pdfBuffer);
    },
    postUnmount: async (io) => {
      const result = await io.file.read("/workspace/output.json");
      await uploadToS3(result);
    },
  },
});

const response = await agent.respond("Extract all line items");
await agent.shutdown();
```

Variable names are checked at compile time. Miss one and it won't build.

---

## Key features

**See inside the sandbox.** In `serve` mode, a WebUI at `localhost:3000` shows the agent's live file tree and terminal output as it runs. No more guessing what the agent is doing.

<!-- screenshot: WebUI showing file tree on the left, live terminal output on the right -->

**No vendor lock-in.** Swap model providers or sandbox backends with one line of YAML. Supports Anthropic, OpenAI, Gemini, Ollama, and any OpenAI-compatible proxy; E2B and Kubernetes sandboxes.

**Consistent runtime across environments.** `serve` and `build` run through the same sandbox abstraction. What passes locally ships as-is.

**Session recovery.** If an agent crashes mid-run, resume from its last conversation state:

```typescript
const agent = await InvoiceProcessor.init({
  variables: { user_name: "Alice" },
  session: savedSessionState,
});
```

Conversation history is restored automatically. Sandbox files are re-seeded via your `preMount` hook.

**MCP for controlled data access.** Connect the agent to internal services via token-scoped MCP servers. The agent runs in a fully privileged sandbox — MCP token scoping is the layer that limits what data it can actually reach:

```yaml
# bundle.yaml
mcp:
  servers:
    - name: refund-service
      url: https://internal.example.com/mcp/refund
      auth: bearer
```

```typescript
const agent = await InvoiceProcessor.init({
  variables: { user_name: "Alice" },
  mcpTokens: { "refund-service": userToken },
});
```

Even under prompt injection, the agent cannot exceed what the MCP server permits for that token.

---

## HTTP API

agent-bundle exposes an [Open Responses](https://github.com/open-responses/open-responses)-compatible endpoint in both `serve` and `build` modes. Any OpenAI SDK connects by overriding `baseURL`:

```
POST /v1/responses
{ "input": "Extract all line items from the invoice", "stream": true }
```

---

## Configuration

### Model

```yaml
model:
  provider: anthropic          # anthropic | openai | gemini | ollama | openrouter
  model: claude-sonnet-4-20250514
```

API keys are resolved from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.). No secrets in YAML.

For `ollama`, `agent-bundle` uses the OpenAI-compatible endpoint from `OLLAMA_BASE_URL` (or `OLLAMA_HOST`), and auto-appends `/v1` when missing. Default: `http://127.0.0.1:11434/v1`. If both are set, `OLLAMA_BASE_URL` takes precedence. If your endpoint requires auth, set `OLLAMA_API_KEY`; otherwise a placeholder key is used automatically.

You can override Ollama runtime hints in YAML:

```yaml
model:
  provider: ollama
  model: qwen2.5-coder
  ollama:
    baseUrl: http://127.0.0.1:11434
    contextWindow: 16384
    maxTokens: 4096
```

`contextWindow` and `maxTokens` are compatibility hints for planning token budgets; the actual limit is determined by the Ollama model and your runtime `num_ctx` setting.

### Sandbox

```yaml
sandbox:
  provider: e2b                # e2b | kubernetes
  timeout: 900
  resources:
    cpu: 2
    memory: 512MB

  e2b:
    template: my-custom-template

  serve:
    provider: kubernetes       # local k3d by default
```

`resources` is optional. If you provide it, specify both `cpu` and `memory`; partial overrides are rejected. Omit `resources` to use defaults (`cpu: 2`, `memory: 512MB`).

### Skills

```yaml
skills:
  - path: ./skills/my-skill           # local directory
  - github: owner/repo                # GitHub repo
    skill: path/to/skill              # path within repo (optional)
    ref: main                         # branch, tag, or commit (optional)
  - url: https://example.com/skills/ocr
    version: 1.2.0
```

---

## Roadmap

- [ ] Pluggable agent loop engines — Claude Code, Codex via process bridge
- [ ] Fine-grained Docker sandbox isolation

---

## License

MIT
