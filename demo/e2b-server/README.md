# E2B Server Demo

End-to-end demo: HTTP request -> Agent -> E2B sandbox -> skill execution -> response.

This demo skill formats Python with `black` (available in the default E2B base image).

## Prerequisites

- Node.js >= 20 and pnpm
- API secrets:
  - `E2B_API_KEY` (for E2B sandbox + template build)
  - one model key (`ANTHROPIC_OAUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, or `ANTHROPIC_API_KEY` by default in this demo)

`agent-bundle build` uses the E2B SDK template build API by default. e2b CLI is only used as a fallback when SDK build fails.

Run all commands from repository root.

## Quick setup

Recommended with Infisical:

```bash
infisical run --env=dev -- ./demo/e2b-server/setup.sh
```

Manual setup:

```bash
e2b template list -f json >/dev/null
pnpm build:demo:e2b-server
```

## Run server

```bash
infisical run --env=dev -- sh -lc 'PORT=3001 pnpm demo:e2b-server'
```

Expected log:

```text
Listening on http://localhost:3001
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
