# Spike: LLM Provider Connectivity

## Context

Agent-bundle uses pi-mono's coding-agent as its built-in agent loop. LLM provider connectivity is handled by pi-mono's LLM Provider Layer. We need to verify that supported providers work correctly in our context, particularly the alternative auth methods designed for local development.

### Architecture constraint

- **Server-side (build mode):** Standard API keys via environment variables. No special auth flows.
- **Local development (serve mode):** May use Codex OAuth or Claude setup-token for convenience — users don't need to manage API keys manually.

LLM API keys live on the **host** (trusted runtime), never inside the sandbox. See `docs/proposal.md` Sandbox Interface for details.

### What we need to verify

pi-mono already has a provider layer. This spike is not about building one — it's about confirming that pi-mono's providers work when invoked from agent-bundle's runtime, and identifying any integration gaps.

---

## Prerequisites (Owner: @user)

- [x] Ensure you have at least one working API key (Anthropic or OpenAI)
- [ ] (Optional) Set up Codex OAuth if you have an OpenAI account with Codex access
- [x] (Optional) Set up Claude Code CLI and run `claude setup-token` if you want to test that flow
I've put them under `.env`.

---

## Research Tasks (Owner: executor)

### R1. Inventory pi-mono's supported providers

**Goal**: List all LLM providers pi-mono supports and their auth mechanisms.

- [x] Read pi-mono's provider configuration code
- [x] Document each provider: name, auth method (API key / OAuth / token), env var names
- [x] Confirm which providers are relevant for agent-bundle v1
- [x] Check if Codex OAuth and Claude setup-token are already supported in pi-mono

### R2. Provider initialization in headless context

**Goal**: Confirm providers can be initialized without interactive prompts.

- [x] Can all providers be configured purely via environment variables / config files?
- [x] Does Codex OAuth require a browser redirect? If so, what's the token lifecycle (refresh token, expiry)?
- [x] Does Claude setup-token produce a long-lived token that can be set as an env var?
- [x] Are there any providers that require TTY/interactive input at startup?

---

## Implementation Tasks (Owner: executor)

### I1. Standard API key smoke test

**Depends on**: R1

- [x] Write a minimal script that initializes pi-mono's agent loop with an LLM API key and sends one message
- [x] Repeat with other keys
- [x] Confirm: response received, no errors, token counting works
- [x] Document the minimal configuration needed (env vars, config shape)

### I2. Codex OAuth test (if supported by pi-mono)

**Depends on**: R1, R2

- [ ] If pi-mono supports Codex OAuth: test the auth flow locally
- [x] Document the token acquisition process
- [ ] Confirm: can the resulting token be persisted and reused without re-auth?
- [ ] If pi-mono does NOT support Codex OAuth: document this and skip

### I3. Claude setup-token test (if supported by pi-mono)

**Depends on**: R1, R2

- [x] If pi-mono supports Claude setup-token: test the auth flow locally
- [x] Document the token format and how to inject it
- [x] Confirm: works in a non-interactive shell (no TTY)
- [ ] If pi-mono does NOT support this: document and skip

---

## Evaluation Criteria

| Criteria | Minimum bar |
|---|---|
| Standard API key | Works with Anthropic and OpenAI |
| Auth methods | Document which alternative auth methods pi-mono supports |
| Headless compatibility | All supported providers work without interactive prompts |
| Configuration | Clear env var / config mapping for each provider |

---

## Findings

> Executor: append your findings below this line.
> Mark task checkboxes as `[x]` when done.

### Execution Date

- Executed on 2026-02-21.

### Code and Artifacts

- Spike script:
  - `spikes/agent-loop/llm-provider/src/run_plan.mjs`
- Spike package:
  - `spikes/agent-loop/llm-provider/package.json`
- Run output:
  - `spikes/agent-loop/llm-provider/results/2026-02-21T05-02-01-168Z.json`

### R1 Findings: provider inventory and auth mechanisms

Code paths used:

Note: all paths below are from the temporary local clone of the pi-mono repo at `/tmp/pi-mono-StDiIi` (not from this `agent-bundle` repository).

- Provider/API registry: `packages/ai/src/providers/register-builtins.ts`
- Provider/model typing: `packages/ai/src/types.ts`
- Model inventory: `packages/ai/src/models.generated.ts`
- Env var key mapping: `packages/ai/src/env-api-keys.ts`
- OAuth provider registry: `packages/ai/src/utils/oauth/index.ts`
- Coding-agent provider docs: `packages/coding-agent/docs/providers.md`

Built-in providers discovered in pi-mono (`KnownProvider`) and auth patterns:

| Provider | Auth mechanism | Env vars / source |
|---|---|---|
| amazon-bedrock | AWS credentials (profile / IAM / bearer token / role credentials) | `AWS_PROFILE` / `AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY` / `AWS_BEARER_TOKEN_BEDROCK` / ECS/IRSA vars |
| anthropic | API key or OAuth bearer token | `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN` |
| azure-openai-responses | API key | `AZURE_OPENAI_API_KEY` (+ base URL or resource config) |
| cerebras | API key | `CEREBRAS_API_KEY` |
| github-copilot | OAuth / token env | OAuth (`/login`) or `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` |
| google | API key | `GEMINI_API_KEY` |
| google-antigravity | OAuth | OAuth (`/login`) |
| google-gemini-cli | OAuth | OAuth (`/login`) |
| google-vertex | ADC credentials (not API key) | ADC + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` |
| groq | API key | `GROQ_API_KEY` |
| huggingface | API key/token | `HF_TOKEN` |
| kimi-coding | API key | `KIMI_API_KEY` |
| minimax | API key | `MINIMAX_API_KEY` |
| minimax-cn | API key | `MINIMAX_CN_API_KEY` |
| mistral | API key | `MISTRAL_API_KEY` |
| openai | API key | `OPENAI_API_KEY` |
| openai-codex | OAuth | OAuth (`/login openai-codex`) + persisted credential |
| opencode | API key | `OPENCODE_API_KEY` |
| openrouter | API key | `OPENROUTER_API_KEY` |
| vercel-ai-gateway | API key | `AI_GATEWAY_API_KEY` |
| xai | API key | `XAI_API_KEY` |
| zai | API key | `ZAI_API_KEY` |

OAuth providers registered by pi-mono:

- `anthropic`
- `github-copilot`
- `google-gemini-cli`
- `google-antigravity`
- `openai-codex`

Relevance for agent-bundle v1 (from `docs/proposal.md` + pi-mono capability):

- Directly relevant and built-in: `anthropic`, `openai`, `google`, `openrouter`, `openai-codex`.
- Local convenience auth relevant: `openai-codex` OAuth, Anthropic OAuth token (`ANTHROPIC_OAUTH_TOKEN`).
- Additional providers are available now and can be exposed by configuration in future scope.

Codex OAuth support and Claude setup-token support in pi-mono:

- Codex OAuth: supported (OAuth provider id `openai-codex`, login + refresh implemented).
- Claude setup-token path: supported via Anthropic OAuth token input (`ANTHROPIC_OAUTH_TOKEN`).

### R2 Findings: headless initialization

- Providers can run non-interactively if credentials are already available through env vars or `auth.json`.
- Codex OAuth acquisition flow does require interactive browser auth initially:
  - OpenAI authorize URL is opened.
  - Callback server listens on `http://localhost:1455/auth/callback`.
  - Manual paste fallback is implemented for headless/SSH situations.
  - Credential shape includes `access`, `refresh`, `expires`, `accountId`; refresh token flow is implemented.
- Claude setup-token compatibility:
  - pi-mono Anthropic provider treats tokens containing `sk-ant-oat` as OAuth tokens.
  - This path uses bearer auth and Claude Code identity headers.
  - Token can be injected as `ANTHROPIC_OAUTH_TOKEN` and used without interactive prompts.
- TTY requirement:
  - Normal provider initialization and inference do not require TTY.
  - Only first-time OAuth login (`/login`) is interactive.

### I1 Results: standard key smoke tests

Implemented script:

- `spikes/agent-loop/llm-provider/src/run_plan.mjs`

Run command:

```bash
cd spikes/agent-loop/llm-provider
npm install
npm run spike
```

Observed results:

- OpenAI (API key via `OPENAI_API_KEY` in `.env`):
  - provider/model: `openai / gpt-5-mini`
  - response: success (`openai-ok`)
  - token usage reported (`input=29`, `output=114`, `totalTokens=143`)
- Anthropic (Claude setup-token injected as `ANTHROPIC_OAUTH_TOKEN`):
  - provider/model: `anthropic / claude-sonnet-4-5`
  - response: success (`anthropic-ok`)
  - token usage reported (`input=42`, `output=7`, `totalTokens=49`)

Minimal configuration used in this spike:

- OpenAI key path (non-interactive):
  - `OPENAI_API_KEY=<key>`
  - Agent uses `getApiKey(provider)` callback in `@mariozechner/pi-agent-core`.
- Anthropic setup-token path (non-interactive):
  - `CLAUDE_CODE_OAUTH_TOKEN=<token>` in local `.env`
  - mapped at runtime to `ANTHROPIC_OAUTH_TOKEN`
  - `@mariozechner/pi-ai` resolves this env token for Anthropic calls.

### I2 Results: Codex OAuth

- pi-mono support: confirmed.
- Token acquisition process: documented from implementation (`packages/ai/src/utils/oauth/openai-codex.ts`).
- Local end-to-end auth-flow execution status: blocked in this workspace due missing `openai-codex` OAuth credential in `~/.pi/agent/auth.json`.
  - Run artifact shows: `supportedInPiMono=true`, `skipped=true`, `skipReason=No openai-codex OAuth credential in ~/.pi/agent/auth.json.`

### I3 Results: Claude setup-token

- Supported in pi-mono Anthropic provider.
- Local test passed in non-interactive mode by injecting token through env var.
- Token format/injection notes:
  - Setup-token is used as OAuth bearer token path.
  - Set `ANTHROPIC_OAUTH_TOKEN` (or map `CLAUDE_CODE_OAUTH_TOKEN` to it before call).
  - No TTY required for request-time initialization once token exists.

### Evaluation Against Criteria

| Criteria | Minimum bar | Actual | Result |
|---|---|---|---|
| Standard API key | Works with Anthropic and OpenAI | OpenAI API key verified; Anthropic verified via OAuth setup-token path (Anthropic API key not provided in this env) | Partial |
| Auth methods | Document which alternative auth methods pi-mono supports | Codex OAuth + Anthropic OAuth/setup-token documented with code paths | Pass |
| Headless compatibility | All supported providers work without interactive prompts | Verified for configured OpenAI + Anthropic setup-token; Codex runtime path documented but not fully exercised due missing credential | Partial |
| Configuration | Clear env var / config mapping for each provider | Full provider inventory + env/config mapping documented | Pass |

### Blockers / Gaps

- Codex OAuth end-to-end test could not be completed in this run because no persisted `openai-codex` OAuth credential was available locally.
- Anthropic API-key path (distinct from setup-token/OAuth path) was not validated because no Anthropic API key was present in the provided `.env`.
