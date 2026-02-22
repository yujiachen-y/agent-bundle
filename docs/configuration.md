---
doc_sync_id: "1252b191-685b-4969-8024-213dd3cc6b2b"
---

# Configuration

agent-bundle is configured via a `bundle.yaml` file. This guide covers all available options.

## Model

```yaml
model:
  provider: anthropic          # anthropic | openai | gemini | ollama | openrouter
  model: claude-sonnet-4-20250514
```

API keys are resolved from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.). No secrets in YAML.

### Ollama

agent-bundle uses the OpenAI-compatible endpoint from `OLLAMA_BASE_URL` (or `OLLAMA_HOST`), and auto-appends `/v1` when missing. Default: `http://127.0.0.1:11434/v1`. If both are set, `OLLAMA_BASE_URL` takes precedence. If your endpoint requires auth, set `OLLAMA_API_KEY`; otherwise a placeholder key is used automatically.

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

## Sandbox

```yaml
sandbox:
  provider: e2b                # e2b | kubernetes
  timeout: 900
  resources:
    cpu: 2
    memory: 512MB

  e2b:
    template: my-custom-template # required for `agent-bundle build` when provider=e2b

  kubernetes:
    build:
      dockerfile: ./Dockerfile # optional: run docker build during `agent-bundle build`
      context: .               # optional: defaults to dockerfile directory
    image: my-sandbox:latest   # required when build is configured

  serve:
    provider: kubernetes       # local k3d by default
```

`resources` is optional. If you provide it, specify both `cpu` and `memory`; partial overrides are rejected. Omit `resources` to use defaults (`cpu: 2`, `memory: 512MB`).

When `sandbox.provider` is `e2b`, `agent-bundle build` generates a temporary build context (`/skills`, `/tools`, `e2b.Dockerfile`) and builds templates via the E2B SDK API. If SDK build fails, it falls back to `e2b template build --path <generated-context> <sandbox.e2b.template>`. If CLI fallback is used and `E2B_ACCESS_TOKEN` is unset while `E2B_API_KEY` is present, the build command reuses `E2B_API_KEY` for CLI auth.

## Skills

```yaml
skills:
  - path: ./skills/my-skill           # local directory
  - github: owner/repo                # GitHub repo
    skill: path/to/skill              # path within repo (optional)
    ref: main                         # branch, tag, or commit (optional)
  - url: https://example.com/skills/ocr
    version: 1.2.0
```

See [Agent Skills](https://github.com/agent-skills/spec) for the skill format.

## MCP Servers

Connect the agent to internal services via token-scoped MCP servers:

```yaml
mcp:
  servers:
    - name: refund-service
      url: https://internal.example.com/mcp/refund
      auth: bearer
```

Then pass tokens at runtime:

```typescript
const agent = await InvoiceProcessor.init({
  variables: { user_name: "Alice" },
  mcpTokens: { "refund-service": userToken },
});
```

Even under prompt injection, the agent cannot exceed what the MCP server permits for that token.

## Prompt

```yaml
prompt:
  system: |
    You are an expert invoice processing assistant.
    Current user: {{user_name}}
  variables:
    - user_name
```

Variables referenced in the system prompt are required at runtime and checked at compile time.
