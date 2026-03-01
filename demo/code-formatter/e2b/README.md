# E2B Formatter Demo

End-to-end demo: WebUI/API request -> Agent -> E2B sandbox -> skill execution -> formatted Python code.

This demo is designed to run as a standalone folder. You do not need to run `pnpm` from the monorepo root.

## Prerequisites

- Node.js >= 20
- `E2B_API_KEY`
- `OPENAI_API_KEY`

## Quick start (standalone)

Run inside this directory:

```bash
npm ci
E2B_API_KEY=... OPENAI_API_KEY=... npm run setup
```

`setup.sh` will:

1. Validate required environment variables
2. Ensure `agent-bundle` CLI is available
3. Run `agent-bundle build --config ./agent-bundle.yaml`
4. Run `agent-bundle dev --config ./agent-bundle.yaml`

Then open `http://localhost:3000` (or the auto-detected worktree port).

## Manual commands

```bash
E2B_API_KEY=... OPENAI_API_KEY=... npx -y agent-bundle@latest build --config ./agent-bundle.yaml
E2B_API_KEY=... OPENAI_API_KEY=... npx -y agent-bundle@latest dev --config ./agent-bundle.yaml
```

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
