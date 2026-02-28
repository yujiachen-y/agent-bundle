# agent-bundle

[![CI](https://github.com/yujiachen-y/agent-bundle/actions/workflows/ci.yml/badge.svg)](https://github.com/yujiachen-y/agent-bundle/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/yujiachen-y/agent-bundle/graph/badge.svg?token=NW998X95RW)](https://codecov.io/gh/yujiachen-y/agent-bundle)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-green.svg)](https://nodejs.org/)
[![Website](https://img.shields.io/badge/Website-agent--bundle.com-8b5cf6)](https://agent-bundle.com)

> Define skills in YAML. Develop with a live sandbox UI. Ship as a typed TypeScript package.

**Anthropic · OpenAI · Gemini · Ollama · OpenRouter** — **E2B · Kubernetes sandboxes** — **AWS ECS Fargate deploy** _(beta)_

---

## Why

Agent skills work great inside local coding agents. Deploying them to production is a different story.

|  | Without agent-bundle | With agent-bundle |
|--|---------------------|-------------------|
| **Develop** | Skills run in local coding agents only | `agent-bundle dev` — WebUI with live sandbox view |
| **Ship** | Rewrite skill logic into a service from scratch | `agent-bundle build` — typed TypeScript factory + Docker image |
| **Behave** | Dev and prod diverge silently | Same sandbox runtime in both modes |

---

## Quick Start

### 1. Install

```bash
pnpm install && pnpm build
```

### 2. Define your bundle

```yaml
# agent-bundle.yaml
name: my-agent

model:
  provider: anthropic
  model: claude-sonnet-4-20250514

prompt:
  system: |
    You are a helpful agent.
    Follow the skill instructions precisely.
  variables:
    - user_name

sandbox:
  provider: kubernetes
  kubernetes:
    image: my-sandbox:latest

skills:
  - path: ./skills/my-skill
```

See [Agent Skills](https://github.com/agent-skills/spec) for the skill format and [Configuration Guide](./docs/configuration.md) for all options.

### 3. Run locally

```bash
agent-bundle dev
```

Opens a WebUI at `http://localhost:3000` where you can chat with the agent and watch its file tree and terminal output in real time — see exactly what it's doing inside the sandbox.

Ready to deploy? See [Build & Embed](#build--embed) below.

---

## Features

- **Live sandbox view** — WebUI at localhost:3000 shows the agent's file tree and terminal in real time. No more black boxes.
- **Type-safe codegen** — Prisma-style `generate`. Variable names are checked at compile time — miss one and it won't build.
- **Dev-prod parity** — `dev`, `serve`, and `build` share the same sandbox abstraction. What passes locally ships as-is.
- **No vendor lock-in** — Swap model providers or sandbox backends with one line of YAML.
- **Session recovery** — Agent crashes mid-run? Resume from its last conversation state.
- **Token-scoped MCP** — Connect to internal services via MCP servers. Even under prompt injection, the agent cannot exceed what the MCP server permits for that token.

---

## Build & Embed

```bash
agent-bundle build
```

Produces a typed, embeddable package:

```
dist/my-agent/
├── index.ts        ← typed agent factory
├── types.ts        ← variable types
├── bundle.json     ← config snapshot
└── package.json    ← scoped package metadata
```

If `sandbox.kubernetes.build` is configured, `agent-bundle build` runs a local `docker build` for that image tag. Image push/import is still an explicit user step.
If `sandbox.provider` is `e2b`, `agent-bundle build` generates a temporary E2B context (`/skills`, `/tools`, `e2b.Dockerfile`) and bakes the resolved template ref into `bundle.json`. See [Configuration Guide](./docs/configuration.md#sandbox) for SDK/CLI fallback and auth details.

### Deploy to AWS _(beta)_

```bash
agent-bundle deploy --target aws --secret API_KEY
```

Pushes the built Docker image to ECR and deploys to ECS Fargate — no Terraform or CloudFormation required. See [Deploy](./docs/configuration.md#deploy-beta) for details.

Integrate into any Node.js service:

```typescript
import { MyAgent } from "./dist/my-agent";

const agent = await MyAgent.init({
  variables: { user_name: "Alice" },
});

const response = await agent.respond([
  { role: "user", content: "Extract all line items" },
]);
await agent.shutdown();
```

Variable names are checked at compile time. See the [Configuration Guide](./docs/configuration.md) for all available YAML options.

---

## Architecture

![Architecture](.github/architecture.png)

The agent orchestrator routes between the LLM provider, sandbox, and MCP servers. All three interfaces share the same abstraction across `dev`, `serve`, and `build` modes.

---

If agent-bundle is useful to you, consider giving it a ⭐. It helps others discover the project.

---

## Roadmap

- [ ] `deploy --target aws` GA — currently beta, stability not guaranteed
- [ ] GCP Cloud Run deploy target
- [ ] Pluggable agent loop engines — Claude Code, Codex via process bridge
- [ ] Fine-grained Docker sandbox isolation

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

[MIT](./LICENSE)
