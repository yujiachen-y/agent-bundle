# K8s Formatter Demo

End-to-end demo: WebUI/API request -> Agent -> Kubernetes sandbox -> skill execution -> formatted Python code.

## Prerequisites

- Docker, k3d, kubectl
- Node.js >= 20 and pnpm
- `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN`

Run commands from repository root.

## Quick start

```bash
ANTHROPIC_API_KEY=... pnpm demo:k8s-server
```

This script provisions the local cluster/image, builds the bundle, and runs:

```text
agent-bundle dev --config demo/code-formatter/k8s/agent-bundle.yaml
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
