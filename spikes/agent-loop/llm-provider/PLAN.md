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

- [ ] Ensure you have at least one working API key (Anthropic or OpenAI)
- [ ] (Optional) Set up Codex OAuth if you have an OpenAI account with Codex access
- [ ] (Optional) Set up Claude Code CLI and run `claude setup-token` if you want to test that flow

---

## Research Tasks (Owner: executor)

### R1. Inventory pi-mono's supported providers

**Goal**: List all LLM providers pi-mono supports and their auth mechanisms.

- [ ] Read pi-mono's provider configuration code
- [ ] Document each provider: name, auth method (API key / OAuth / token), env var names
- [ ] Confirm which providers are relevant for agent-bundle v1
- [ ] Check if Codex OAuth and Claude setup-token are already supported in pi-mono

### R2. Provider initialization in headless context

**Goal**: Confirm providers can be initialized without interactive prompts.

- [ ] Can all providers be configured purely via environment variables / config files?
- [ ] Does Codex OAuth require a browser redirect? If so, what's the token lifecycle (refresh token, expiry)?
- [ ] Does Claude setup-token produce a long-lived token that can be set as an env var?
- [ ] Are there any providers that require TTY/interactive input at startup?

---

## Implementation Tasks (Owner: executor)

### I1. Standard API key smoke test

**Depends on**: R1

- [ ] Write a minimal script that initializes pi-mono's agent loop with an Anthropic API key and sends one message
- [ ] Repeat with an OpenAI API key
- [ ] Confirm: response received, no errors, token counting works
- [ ] Document the minimal configuration needed (env vars, config shape)

### I2. Codex OAuth test (if supported by pi-mono)

**Depends on**: R1, R2

- [ ] If pi-mono supports Codex OAuth: test the auth flow locally
- [ ] Document the token acquisition process
- [ ] Confirm: can the resulting token be persisted and reused without re-auth?
- [ ] If pi-mono does NOT support Codex OAuth: document this and skip

### I3. Claude setup-token test (if supported by pi-mono)

**Depends on**: R1, R2

- [ ] If pi-mono supports Claude setup-token: test the auth flow locally
- [ ] Document the token format and how to inject it
- [ ] Confirm: works in a non-interactive shell (no TTY)
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
