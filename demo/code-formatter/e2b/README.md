# E2B Formatter Demo

End-to-end demo: WebUI/API request -> Agent -> E2B sandbox -> skill execution -> formatted Python code.

## Prerequisites

- Node.js >= 20 and pnpm
- `E2B_API_KEY`
- `OPENAI_API_KEY`

Run commands from repository root.

## Quick start

```bash
E2B_API_KEY=... OPENAI_API_KEY=... pnpm demo:e2b-server
```

This runs `agent-bundle dev` with:

```text
demo/code-formatter/e2b/agent-bundle.yaml
```

By default, open `http://localhost:3000` (or the auto-detected worktree port).

## Test with curl

```bash
curl http://localhost:3000/health
```

```bash
curl -s http://localhost:3000/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{
    "input": [
      {
        "role": "user",
        "content": "Format this Python code:\nimport os\ndef foo( x,y ):\n  return x+y\nfoo(1,2)"
      }
    ]
  }'
```
