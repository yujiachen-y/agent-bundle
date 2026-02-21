---
title: "Agent Bundle Proposal"
author: ""
createdAt: 2026-02-17
updatedAt: 2026-02-21
status: draft
doc_sync_id: "c9ec52be-fc83-49d5-aec5-c720b5cf0674"
---
# Agent Bundle Proposal

> Bundle skills into a single deployable agent.

## Background

Since Anthropic open-sourced the Agent Skills standard in late 2025, skills have become the de facto unit of capability for coding agents. OpenAI and other major players have adopted the standard, and the industry consensus is shifting from writing code directly to building reusable skills that agents execute on behalf of users.

## Problem Statement

The Agent Skills widely used today do not yet map naturally to an online-service ecosystem. They work well inside local coding agents, but there is still no effective, standardized path to deploy them as online services.

This creates a structural gap and significant friction between local development and production environments:

1. Deployment limitations  
   Teams can share skills for local use, but consumers must manually install them in their own agent setups. These skills cannot be published and operated as first-class online services.
2. Organizational impact
   This friction is tolerable for individual users but scales poorly. All three major cloud vendors have launched initiatives to address this gap [3][4][5], and industry data shows only 5-14% of agentic AI projects successfully transition from pilot to production [1][2].
3. Technical debt and migration cost  
   To ship online, developers must rewrite logic and add deployment-specific validation. This creates high migration cost, inconsistency between offline and online behavior, and long-term maintenance burden.


## Proposed Solution

We propose a lightweight, self-contained agent runtime that loads a curated set of Agent Skills, executes them via a built-in agent loop, and exposes the result as a deployable service.

The runtime consists of the following core components:

1. Built-in Agent Loop
   A lightweight loop that handles tool calling and structured output for each incoming request. Skills are plain SKILL.md files seeded into the sandbox at build time; skill summaries are baked into the system prompt, and the agent reads full skill content on demand via built-in tools.
2. LLM Provider Layer
   Supports major providers natively (Anthropic, OpenAI, Gemini) and accepts third-party provider proxies such as LiteLLM and OpenRouter. For local development and personal use, it also supports Ollama, Codex OAuth, and Claude `setup-token` for accessing local or third-party compute.
3. Service Interface
   Exposes a minimal external API surface (an Open Responses-compatible HTTP API) for external integration. Encapsulates internal mechanics including agent-loop orchestration, sandbox management, and filesystem setup.

The runtime is packaged into a Docker image via a YAML-driven configuration, producing a single deployable artifact ready for cloud or local use.

## What This Is Not

Agent Bundle is not a wrapper around existing user-facing agent tools such as Claude Code, Codex, or Cursor. The v1 built-in agent loop is implemented using pi-mono as an internal library; this is a deliberate implementation choice, not a user-facing dependency. The service interface, sandbox abstraction, and build pipeline are all agent-bundle's own design.

## Goals and Non-Goals

### Goals

1. Provide a YAML-driven tool that declares a bundle (skills, model, permissions) and produces a runnable agent in two modes:
   - `serve` — runs as a local process for development and testing
   - `build` — produces a Docker image for online deployment
2. Include a built-in runtime in both modes:
   - a simple Agent Loop for request execution
   - a k3d-based sandbox for `serve` mode; E2B or Kubernetes for `build` mode
3. Expose built-in service interfaces appropriate to each mode:
   - a minimal Open Responses-compatible HTTP API (available in both modes)
   - terminal/TUI and WebUI with live file tree and terminal output (local `serve` mode only)
4. Keep token and model-consumption strategy externally configurable by users.

### Non-Goals

1. Token and compute provisioning  
   We do not provide token budgets or LLM compute. Users must bring their own model access and related resources.
2. Persistence layer  
   The packaged runtime is fundamentally stateless and may be destroyed after use. Users are responsible for external persistence and for coordinating reloadable/re-entrant agent execution.
3. Skill security validation (current scope)  
   Users are responsible for ensuring packaged skills are valid and non-malicious. We may add baseline behavioral checks in the future, but that is outside the current core scope.
4. Cloud deployment orchestration
   We only produce a deployable image artifact and do not own downstream cloud deployment workflows.

## Future Work

The following items are intentionally excluded from the initial scope but may be explored in later iterations:

1. Pluggable Agent Loop engines
   The initial release ships a single built-in agent loop. Supporting pluggable or user-supplied loop implementations may be considered once the core runtime stabilizes.
2. Advanced sandbox integrations
   The initial release provides a basic built-in sandbox service. Docker-oriented sandboxing with fine-grained isolation may be added based on user demand.

## Design Overview

### Architecture

```mermaid
graph TD
    subgraph External Interfaces
        direction LR
        HTTP["Responses API\n(Open Responses)"]
        TUI["TUI *"]
        WebUI["WebUI *"]
    end

    subgraph Agent
        direction TB
        ORCH["Agent Orchestrator\nroutes tool calls · manages lifecycle"]

        subgraph Agent Loop
            direction LR
            PROMPT["System Prompt\n+ skill metadata"]
            TOOLS["Built-in Tools\nBash · Read · Write · Edit"]
        end
        LLM["LLM Provider Layer\nAnthropic · OpenAI · Gemini · OpenRouter · Ollama · …"]

        subgraph Sandbox
            subgraph Volume
                SKILLS["/skills/\nSKILL.md + scripts/"]
                WORKSPACE["/workspace/\nagent working directory"]
            end
            HOOKS["Lifecycle Hooks\npreMount · postMount · preUnmount · postUnmount"]
        end
    end

    EXT_MCP["External MCP Servers\n(permission-scoped via token)"]

    HTTP & TUI & WebUI -->|request| ORCH
    ORCH -->|user message| PROMPT
    PROMPT --> TOOLS
    TOOLS -->|LLM calls| LLM
    ORCH -->|tool routing| WORKSPACE
    ORCH -->|mcp tool calls| EXT_MCP
    HOOKS <-->|mount · unmount| Volume
```

\* TUI and WebUI are available in local `serve` mode only.

### Sandbox

The sandbox abstraction provides a provider-agnostic interface for tool execution and file operations. Two providers are supported in v1: **E2B** (managed cloud sandboxes) and **Kubernetes** (self-hosted via k3d or any K8s cluster). Both `serve` and `build` modes run through the sandbox to ensure behavioral consistency; `serve` defaults to a local Docker/k3d sandbox.

#### Lifecycle

All hooks execute while the sandbox is alive and IO is available.

```
create ──► preMount ──► postMount ──► [agent session] ──► preUnmount ──► postUnmount ──► destroy
           (seed files)  (validate)                       (collect)      (upload/notify)
```

1. **create** — Sandbox infrastructure is provisioned (E2B sandbox started / K8s pod running). IO becomes available.
2. **preMount** — Seed session-specific files into the sandbox (e.g., user uploads, session config).
3. **postMount** — Validate setup, warm caches, run health checks. Sandbox is ready for the agent.
4. **[agent session]** — The agent loop runs. All tool calls are routed to the sandbox.
5. **preUnmount** — Agent session ends. Collect artifacts, flush logs, snapshot state.
6. **postUnmount** — Upload artifacts to external storage, notify external systems, clean up.
7. **destroy** — Sandbox infrastructure is torn down. All resources released.

#### Configuration

Common fields (timeout, resources) are provider-agnostic. Provider-specific settings go under the provider key only when needed.

```yaml
sandbox:
  provider: e2b              # or: kubernetes
  timeout: 900               # seconds
  resources:
    cpu: 2
    memory: 512MB

  # Provider-specific (optional)
  e2b:
    template: my-custom-template

  # kubernetes:
  #   namespace: agent-sandbox
  #   nodeSelector:
  #     gpu: "true"

  serve:                     # override for serve mode (optional)
    provider: kubernetes     # defaults to local docker/k3d
```

#### Interface

**build** (CLI only, offline)

Reads the bundle YAML, packages skills and base tools into a sandbox template or image. For E2B this produces and uploads a template; for Kubernetes this builds and pushes a Docker image. This is not exposed as a runtime API — users run `agent-bundle build` from the CLI.

**Sandbox object** (runtime)

Created in memory with configuration and lifecycle hooks. No real resources are allocated until `start()` is called. Hooks are registered as constructor parameters.

```typescript
interface SandboxHooks {
  preMount?: (io: SandboxIO) => Promise<void>;
  postMount?: (io: SandboxIO) => Promise<void>;
  preUnmount?: (io: SandboxIO) => Promise<void>;
  postUnmount?: (io: SandboxIO) => Promise<void>;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

interface SandboxIO {
  exec(command: string, opts?: {
    timeout?: number;
    cwd?: string;
    onChunk?: (chunk: string) => void;  // real-time output for human consumers (TUI, WebUI, extensions)
  }): Promise<ExecResult>;
  file: {
    read(path: string): Promise<string>;
    write(path: string, content: string | Buffer): Promise<void>;
    list(path: string): Promise<FileEntry[]>;
    delete(path: string): Promise<void>;
  };
}

type SandboxStatus =
  | "idle"      // created in memory, not yet started
  | "starting"  // provisioning infrastructure + running hooks
  | "ready"     // agent can use the sandbox
  | "stopping"  // running shutdown hooks + destroying
  | "stopped";  // all resources released

interface Sandbox extends SandboxIO {
  readonly id: string;
  readonly status: SandboxStatus;

  start(): Promise<void>;     // create → preMount → postMount → ready
  shutdown(): Promise<void>;  // preUnmount → postUnmount → destroy
}
```

#### Design Decisions

- **No path restrictions.** The sandbox is ephemeral (1:1 session model). Skills in `/skills/` are restored on every new session. The agent has full freedom within the sandbox; no write-protection is enforced on any path.
- **exec returns the full result on completion, with optional real-time streaming.** The `onChunk` callback provides real-time output chunks for human consumers (TUI, WebUI, extensions) while the command runs. The LLM only sees the final `ExecResult`. This matches pi-mono's Bash tool model: `onChunk` feeds `tool_execution_update` events to the UI layer, while the agent loop waits for the final result to send back to the LLM.
- **Hooks receive `SandboxIO`, not the full `Sandbox`.** This prevents hooks from accidentally calling `start()` or `shutdown()`. Hooks can use both `exec` and `file` operations without restriction.

#### Providers

| Provider | `start()` | `exec()` / `file.*` | `shutdown()` |
|---|---|---|---|
| **E2B** | `Sandbox.create(template)` | E2B SDK: `commands.run()`, `files.read/write()`. Streaming via native `onStdout`/`onStderr` callbacks. | `sandbox.kill()` |
| **Kubernetes** | Create pod from image, wait for ready | execd HTTP endpoints: `/command/run`, `/files/*`. Streaming via SSE on the `/command/run` endpoint. | Delete pod |

### Agent Loop

The agent loop handles LLM interaction: it sends the system prompt and user messages to the LLM, receives tool call decisions, and returns the final response. It does **not** own the sandbox — the Agent orchestrator (see below) wires tool calls from the loop to the sandbox.

#### Interface

```typescript
interface AgentLoop {
  init(config: {
    systemPrompt: string;
    model: ModelConfig;
    toolHandler: (call: ToolCall) => Promise<ToolResult>;
  }): Promise<void>;

  run(input: ResponseInput): AsyncIterable<ResponseEvent>;
  dispose(): Promise<void>;
}
```

`toolHandler` is a callback provided by the Agent orchestrator. When the LLM decides to call a tool (Bash, Read, Write, Edit), the agent loop invokes `toolHandler`, which routes the call to the sandbox. The loop does not know what sandbox is or how it works.

#### LLM Provider

Follows pi-mono's conventions. Provider and model are specified in the bundle YAML; API keys are resolved from environment variables automatically (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). No secrets in YAML.

```yaml
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
```

pi-mono's `@mariozechner/pi-ai` package handles provider initialization, auth methods (API keys, OAuth tokens, `claude setup-token`), and request routing. agent-bundle passes through the configuration without building its own provider layer.

#### System Prompt

The system prompt is generated at build time from the bundle YAML and skill metadata. User-defined variables are declared in the YAML and filled at runtime.

```yaml
prompt:
  system: |
    You are an expert invoice processing assistant.
    Current user: {{user_name}}
    Timezone: {{timezone}}

  variables:
    - user_name
    - timezone
```

Skills are automatically appended to the system prompt at build time (not via a placeholder). Each skill's SKILL.md frontmatter (name + description) is injected by default. The agent reads full SKILL.md content on demand via its tools during the session.

At runtime, only variables need to be filled. Build-time generation freezes the prompt template — zero runtime cost for prompt assembly.

#### Providers

v1 ships with pi-mono. The interface supports future agent loops via direct integration (TypeScript) or process bridges (CLI-based tools).

| Agent Loop | Language | Integration | Status |
|---|---|---|---|
| **pi-mono** | TypeScript | In-process, sandbox-backed Operations | v1 |
| Other TS loops | TypeScript | In-process or fork | Future |
| Claude Code | CLI (Node) | Bridge: spawn process, message protocol | Future |
| Codex | CLI (Rust) | Bridge: spawn process, message protocol | Future |

For pi-mono specifically, the `toolHandler` is implemented by injecting sandbox-backed operation interfaces into pi-mono's tool layer:

```
pi-mono Tool Layer (host)
  │
  ├── Read tool  ──► ReadOperations  ──► sandbox.file.read()
  ├── Write tool ──► WriteOperations ──► sandbox.file.write()
  ├── Edit tool  ──► ReadOperations + WriteOperations
  │                  (pi-mono handles fuzzy matching, BOM, line endings;
  │                   file IO delegates to sandbox)
  └── Bash tool  ──► BashOperations  ──► sandbox.exec()
```

This preserves pi-mono's full tool logic (Edit's fuzzy matching, output truncation, etc.) while routing all IO to the sandbox.

### Agent

The Agent is the top-level orchestrator. It owns both the sandbox and the agent loop, wires them together, and exposes the client-facing API.

```
Agent (orchestrator)
  ├── Sandbox (tool execution environment)
  ├── AgentLoop (LLM interaction)
  └── wiring: loop.toolHandler → sandbox.exec / sandbox.file.*
```

#### Build Pipeline

The bundle YAML is a build-time input. `agent-bundle build` produces two artifacts:

1. **Sandbox image** — pushed to E2B (template) or Docker registry (image). Contains skills and base tools.
2. **Agent factory** — generated TypeScript code with all configuration baked in (system prompt template, model config, sandbox image reference, typed variables).

```
agent-bundle.yaml + skills/
        │
        ▼
  agent-bundle build
        │
        ├── push sandbox image/template
        └── generate code artifact
                │
                ▼
        dist/invoice-processor/
          ├── index.ts          generated agent factory
          ├── bundle.json       config snapshot
          └── types.ts          variable types
```

No YAML is loaded at runtime. The generated artifact is self-contained.

#### Agent Factory

`agent-bundle build` generates a typed agent factory:

```typescript
// generated: dist/invoice-processor/index.ts
import { defineAgent } from "agent-bundle/runtime";

export const InvoiceProcessor = defineAgent({
  name: "invoice-processor",
  sandbox: { provider: "e2b", template: "invoice-processor:a3f8c2d" },
  model: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  systemPrompt: "You are an expert...\n\n## Skills\n...",
  variables: ["user_name", "timezone"] as const,
});

// generated: dist/invoice-processor/types.ts
export interface InvoiceProcessorVariables {
  user_name: string;
  timezone: string;
}
```

Usage:

```typescript
import { InvoiceProcessor } from "./dist/invoice-processor";

const agent = await InvoiceProcessor.init({
  variables: { user_name: "Alice", timezone: "UTC+8" },
  hooks: {
    preMount: async (io) => {
      await io.file.write("/workspace/invoice.pdf", pdfBuffer);
    },
    postUnmount: async (io) => {
      const result = await io.file.read("/workspace/output.json");
      await uploadToS3(result);
    },
  },
});
```

`InvoiceProcessor` is an agent factory (reusable). `.init()` creates an Agent instance (has a running sandbox + agent loop).

#### Agent Interface

```typescript
interface Agent {
  readonly name: string;
  readonly status: "ready" | "running" | "stopped";

  respond(input: ResponseInput): Promise<ResponseOutput>;
  respondStream(input: ResponseInput): AsyncIterable<ResponseEvent>;
  shutdown(): Promise<void>;
}
```

`respond` waits for the full agent response. `respondStream` returns an async iterable of SSE-compatible events following the [Open Responses](https://github.com/open-responses/open-responses) spec.

#### Init Sequence

```
InvoiceProcessor.init({ variables, hooks })
  │
  ├── 1. Fill system prompt template (replace variables, skills already baked in)
  ├── 2. Create Sandbox (image ref baked in)
  │       └── sandbox.start() → preMount → postMount → ready
  ├── 3. Create AgentLoop (pi-mono for v1)
  │       └── loop.init({ systemPrompt, model, toolHandler })
  │           toolHandler routes to sandbox.exec / sandbox.file.*
  └── 4. Return Agent instance
```

#### HTTP Interface

In `serve` mode, agent-bundle exposes an [Open Responses](https://github.com/open-responses/open-responses)-compatible HTTP API. Any OpenAI SDK can connect by overriding `baseURL`.

```
POST /v1/responses
{
  "input": "Extract all line items from the uploaded invoice",
  "stream": true
}

// SSE events:
data: {"type": "response.created", ...}
data: {"type": "response.output_text.delta", "delta": "The invoice contains..."}
data: {"type": "response.completed", ...}
```

#### Session Model

Sessions support error recovery. If an agent crashes mid-execution, the session can be resumed by passing the saved conversation history into a new `init()` call.

```typescript
interface SessionState {
  conversationHistory: ResponseInput;
}
```

The `session` field is an optional parameter in `InitOptions`:

```typescript
const agent = await InvoiceProcessor.init({
  variables: { user_name: "Alice", timezone: "UTC+8" },
  session: savedState,  // omit for a fresh session
});
```

**What is and is not restored on resume:**

- **Conversation history** — restored from `SessionState`. The LLM has full context of previous work.
- **Sandbox files** — not automatically restored. The sandbox is re-provisioned from scratch (`preMount` runs again). Restoring sandbox files from a previous session is the caller's responsibility via `preMount` (e.g., re-fetch artifacts from external storage).

Session persistence is the caller's responsibility. agent-bundle provides the `SessionState` interface and accepts it at `init()`; storage and retrieval are left to the business layer.

### MCP Integration

The agent can invoke tools on external MCP servers to access internal services (e.g., user data, domain operations) from within the sandbox.

#### Accessing Internal Services

External MCP servers are declared in the bundle YAML. At session creation, the caller injects per-user tokens; the agent runtime uses these tokens when establishing MCP connections.

```yaml
mcp:
  servers:
    - name: refund-service
      url: https://internal.example.com/mcp/refund
      auth: bearer
    - name: inventory-service
      url: https://internal.example.com/mcp/inventory
      auth: bearer
```

Tokens are passed at `init()` time:

```typescript
const agent = await InvoiceProcessor.init({
  variables: { user_name: "Alice", timezone: "UTC+8" },
  mcpTokens: {
    "refund-service": userRefundToken,
    "inventory-service": userInventoryToken,
  },
});
```

#### Security Model

The agent runs inside a sandbox (high-privilege compute environment). External MCP servers sit outside the sandbox as controlled gateways:

```
Sandbox (agent execution)
  └── MCP client (in agent runtime process, outside sandbox)
        └── External MCP server (validates token, scopes to current user)
```

The token passed to each MCP server scopes all operations to the current user's resources. Even if the agent is subject to prompt injection, it cannot exceed what the MCP server permits for that token. This is defense-in-depth: sandbox isolation bounds compute, MCP token scoping bounds data access.

#### Tool Routing

MCP tool calls are routed by the Agent Orchestrator alongside built-in sandbox tools:

```
Agent Orchestrator (toolHandler)
  ├── Built-in tools (Bash, Read, Write, Edit) → sandbox.exec / sandbox.file.*
  └── MCP tools (declared in YAML)            → MCP client → external MCP server
```

## Implementation Plan

<!-- Break down the work into phases or milestones. -->

## Open Questions

<!-- List unresolved questions or areas needing further discussion. -->

## References

1. Cleanlab, "AI Agents in Production 2025: Enterprise Trends and Best Practices," https://cleanlab.ai/ai-agents-in-production-2025/
2. Deloitte, "Emerging Technology Trends 2025/2026" (agentic AI adoption data)
3. AWS DevOps Agent Team, "Graduating Prototypes into Products," January 2026
4. Microsoft Azure AI Foundry, "Agent Factory: From Local to Production," https://azure.microsoft.com/en-us/products/ai-foundry
5. Google Cloud, "Production-Ready AI Learning Path," November 2025
