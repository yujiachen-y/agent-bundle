# LLM Provider Spike Conclusion

## Verdict: Ready for v1

pi-mono's provider layer covers all providers we need. Standard API keys work out of the box. Alternative auth methods (Codex OAuth, Claude setup-token) are supported for local dev convenience.

## Key Findings

### Provider coverage

pi-mono supports 20 providers. For agent-bundle v1, the directly relevant ones are:

| Provider | Auth method | Verified in spike |
|---|---|---|
| `anthropic` | API key (`ANTHROPIC_API_KEY`) or OAuth token (`ANTHROPIC_OAUTH_TOKEN`) | Yes (OAuth token path) |
| `openai` | API key (`OPENAI_API_KEY`) | Yes |
| `google` | API key (`GEMINI_API_KEY`) | No (not tested, expected to work) |
| `openrouter` | API key (`OPENROUTER_API_KEY`) | No (not tested, expected to work) |
| `openai-codex` | OAuth (`/login openai-codex`) | Documented, not exercised (missing credential) |

Additional providers (Groq, Mistral, HuggingFace, Bedrock, Vertex, etc.) are available via pi-mono with no extra work from us.

### Local dev auth methods

| Method | How it works | Headless compatible |
|---|---|---|
| **Claude setup-token** | Set `ANTHROPIC_OAUTH_TOKEN` with the token from `claude setup-token`. pi-mono detects `sk-ant-oat` prefix and uses bearer auth. | Yes — env var only, no TTY needed |
| **Codex OAuth** | First-time: browser redirect to OpenAI authorize URL, callback on `localhost:1455`. Credential persisted to `~/.pi/agent/auth.json`. Refresh token flow implemented. | First auth is interactive; subsequent use is headless |

### Architecture confirmation

- All providers initialize without TTY when credentials are pre-configured (env vars or persisted auth file).
- Provider selection and API key resolution are handled entirely by pi-mono's `@mariozechner/pi-ai` package.
- agent-bundle does not need to build its own provider layer — just pass through the configuration.

## Gaps

1. **Anthropic API key path not tested** — only the OAuth/setup-token path was exercised. Expected to work (it's the simpler code path), but should be verified when an API key is available.
2. **Codex OAuth e2e not tested** — no credential was available. The code path is documented and implemented in pi-mono; blocked only by missing local credential.

Neither gap is a blocker for v1. Both are standard code paths in pi-mono that work for existing pi-mono users.

## Recommendation for agent-bundle

1. **Server-side (build mode):** Accept standard API keys via environment variables. No special handling needed — pi-mono resolves them automatically.
2. **Local dev (serve mode):** Document how to use `claude setup-token` and Codex OAuth for convenience. The TUI/CLI can prompt users to set up auth on first run.
3. **No provider abstraction layer needed.** pi-mono's provider layer is the abstraction. agent-bundle configures which provider/model to use in the bundle YAML and passes it through.
