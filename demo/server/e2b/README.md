# E2B Server Demo

End-to-end demo: HTTP request -> Agent -> E2B sandbox -> skill execution -> response.

This demo skill formats Python with `black` (available in the default E2B base image).

## Prerequisites

- Node.js >= 20 and pnpm
- API secrets:
  - `E2B_API_KEY` (for E2B sandbox + template build)
  - one model key (`ANTHROPIC_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` by default in this demo)

`agent-bundle build` uses the E2B SDK template build API by default. e2b CLI is only used as a fallback when SDK build fails.

Run all commands from repository root.

## Quick start

One command handles everything — E2B API validation, bundle build, and
server startup:

```bash
infisical run --env=dev -- pnpm demo:e2b-server
```

Or with explicit environment variables:

```bash
E2B_API_KEY=... ANTHROPIC_API_KEY=sk-... pnpm demo:e2b-server
```

The script is idempotent: on repeat runs, already-built templates are
reused automatically.

Expected log:

```text
Listening on http://localhost:3001
```

### LLM provider

The demo ships with `provider: anthropic` / `model: claude-sonnet-4-5` in
`agent-bundle.yaml`. Set the matching API key as an environment variable:

| Provider | Environment variable | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` | |
| `openai` | `OPENAI_API_KEY` | |
| `gemini` | `GEMINI_API_KEY` | |
| `openrouter` | `OPENROUTER_API_KEY` | |
| `ollama` | *(none required)* | Needs a running Ollama instance |

To switch providers, edit `agent-bundle.yaml`:

```yaml
model:
  provider: ollama          # or openai, gemini, openrouter
  model: qwen2.5-coder      # model name for the chosen provider
```

## Test with curl

Run requests sequentially in this demo. The server uses one in-memory agent instance, so concurrent requests can return `Agent is already running.`.

Health check:

```bash
curl http://localhost:3001/health
```

Non-streaming:

```bash
curl -s http://localhost:3001/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "input": [
      {
        "role": "user",
        "content": "Format this Python code:\nimport os\ndef foo( x,y ):\n  return x+y\nfoo(1,2)"
      }
    ]
  }' | jq .
```

Streaming:

```bash
curl -N http://localhost:3001/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "input": [
      {
        "role": "user",
        "content": "Format this code:\ndef bar(a,b,c):\n  if a>b:\n    return c\n  else:\n    return a+b"
      }
    ],
    "stream": true
  }'
```

## Success criteria

1. Stream includes `response.tool_call.created` and `response.tool_call.done`.
2. Final output contains formatted Python code from `/workspace/input.py`.
3. No local docker/k8s dependency is required for runtime.

## Cleanup

Stop server with `Ctrl+C`.
