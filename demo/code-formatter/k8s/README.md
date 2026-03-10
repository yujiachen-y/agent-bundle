# K8s Formatter Demo

End-to-end demo: WebUI/API request -> Agent -> Kubernetes sandbox -> skill execution -> formatted Python code.

## Prerequisites

- Docker, k3d, kubectl
- Node.js >= 20 and npm
- `OPENROUTER_API_KEY`

## Quick start

```bash
cd demo/code-formatter/k8s
OPENROUTER_API_KEY=... npm run setup
```

The setup script installs dependencies, ensures a local k3d cluster, builds sandbox images, imports them, and runs:

```text
npx agent-bundle dev --config ./agent-bundle.yaml
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
