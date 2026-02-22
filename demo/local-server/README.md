# Local Server Demo

End-to-end demo: HTTP request → Agent → K8s sandbox → skill execution → response.

## How it works

```
agent-bundle.yaml           ← bundle definition (model, sandbox, skills)
skills/format-code/SKILL.md ← skill instructions
        │
        ▼
agent-bundle generate --config demo/local-server/agent-bundle.yaml
        │
        ▼
node_modules/@agent-bundle/code-formatter/index.ts ← generated output (exports AgentFactory)
        │
        ▼
main.ts  ← your application code (imports factory, starts HTTP server)
```

## Prerequisites

- Docker, k3d, and kubectl installed
- An LLM API key (see [LLM provider](#llm-provider) below)
- Node.js ≥ 20 and pnpm
- Dependencies installed (`pnpm install`)

Run all commands from the **repository root**.

## Quick setup

A setup script handles cluster creation, image build, and kubeconfig in one
command:

```bash
./demo/local-server/setup.sh
```

Then skip to [Run the server](#run-the-server).

## Manual setup

### 1. Create a k3d cluster

```bash
k3d cluster create agent-sandbox
```

### 2. Build and import the demo sandbox image

```bash
# Build base execd image, then build demo bundle + sandbox image
pnpm build:demo:local-server

# Import into k3d
k3d image import agent-bundle/local-server-execd:latest -c agent-sandbox
```

### 3. Fix kubeconfig (macOS / Docker Desktop)

On macOS, k3d writes `host.docker.internal` as the API server address, which
is usually unreachable from the host. Generate a fixed kubeconfig:

```bash
k3d kubeconfig get agent-sandbox \
  | sed 's#https://host.docker.internal:#https://127.0.0.1:#' \
  > /tmp/agent-sandbox.kubeconfig

export KUBECONFIG=/tmp/agent-sandbox.kubeconfig
```

> **Note**: The agent-bundle runtime auto-normalizes `host.docker.internal`
> for k3d clusters, so the server itself works without this step. The fixed
> kubeconfig is only needed for `kubectl` commands to work on the host.

If you are on Linux or your default kubeconfig already works, you can skip
this step.

### 4. Verify the cluster is ready

```bash
kubectl get nodes
# Should show one node with STATUS=Ready
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

## Run the server

```bash
ANTHROPIC_API_KEY=sk-... pnpm demo:local-server
```

You should see:

```
Listening on http://localhost:3000
```

## Test with curl

### Health check

```bash
curl http://localhost:3000/health
```

Expected:

```json
{ "status": "ok" }
```

### Non-streaming request

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
  }' | jq .
```

### Streaming request

```bash
curl -N http://localhost:3000/v1/responses \
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

Streaming events you should see:

| Event type | Meaning |
|---|---|
| `response.created` | Agent started processing |
| `response.tool_call.created` | Tool invoked (Write / Bash / Read) |
| `response.tool_call.done` | Tool completed |
| `response.output_text.delta` | Incremental text output |
| `response.completed` | Final response with full output |

## Success criteria

1. Streaming events show `response.tool_call.created` for **Write**, **Bash**, and **Read** tools
2. The agent wrote code to a file inside the K8s sandbox
3. The agent ran a formatter via Bash in the sandbox
4. The HTTP response contains the formatted code

## Reference

### How K8s connectivity works

The sandbox connects to your cluster via the standard kubeconfig at
`~/.kube/config` — the same config `kubectl` uses. `k3d cluster create`
automatically adds the cluster to your kubeconfig, so no extra URL
configuration is needed.

To use a non-default kubeconfig, set `kubernetes.kubeconfig` in
`agent-bundle.yaml`:

```yaml
sandbox:
  kubernetes:
    kubeconfig: /path/to/kubeconfig
```

The sandbox image is configured in `agent-bundle.yaml` under
`sandbox.kubernetes.image`. The demo defaults to
`agent-bundle/local-server-execd:latest`, built from
`demo/local-server/Dockerfile` (which includes `autopep8` for this demo flow),
and uses `agent-bundle/execd:latest` as its base image.

### Project structure

```
demo/local-server/
├── agent-bundle.yaml           # Bundle config: model, sandbox, skills, docker build inputs
├── Dockerfile                  # Demo-only sandbox image (execd + autopep8)
├── setup.sh                    # One-command environment setup
├── skills/
│   └── format-code/
│       └── SKILL.md            # Skill: Write → Bash → Read in sandbox
├── main.ts                     # Entry point: imports generated factory
└── ../../node_modules/@agent-bundle/code-formatter/
    ├── index.ts                # Generated agent factory
    ├── types.ts                # Generated variable interface
    ├── bundle.json             # Resolved config snapshot
    └── package.json            # Scoped package metadata
```

### What the generated `@agent-bundle/code-formatter` does

This package is generated by `agent-bundle generate`. It:

1. Bakes model, sandbox image, prompt template, and variable names into code
2. Exports a typed `AgentFactory` with an `init()` method
3. Keeps a `bundle.json` snapshot for traceability/debugging

### What `main.ts` does

This is the user-written entry point. It:

1. Imports the generated `AgentFactory` from `@agent-bundle/code-formatter`
2. Calls `factory.init()` to create a live `Agent` (connects to sandbox, model)
3. Wraps the agent in an HTTP server via `createServer()`
4. Listens on `PORT` (default 3000)

```typescript
import { serve } from "@hono/node-server";
import { CodeFormatter as factory } from "@agent-bundle/code-formatter";
import { createServer } from "agent-bundle/service";

const instance = await factory.init({ variables: {} as Record<never, string> });

const app = createServer(instance);
serve({ fetch: app.fetch, port: 3000 });
```

## Cleanup

```bash
# Stop the server with Ctrl+C, then:
kubectl delete pods -n default -l app=agent-sandbox --ignore-not-found=true

# To remove the cluster entirely:
k3d cluster delete agent-sandbox
```
