---
doc_sync_id: "40c542a5-1d89-4942-9b69-f6834a36cc0e"
---

# Sandbox Universal MCP Transport Support

## Status: Implemented

## Goal

Enable the sandbox to natively support **all MCP transport types** (stdio, SSE, Streamable HTTP, WebSocket) — not just HTTP. The agent should be able to run any MCP server inside a sandbox regardless of its transport, without forcing everything through an HTTP bridge.

---

## Background & Context

### What works today

Plugins can declare MCP servers in `.mcp.json`. The loader fetches this file, parses it, and merges the servers into the agent config. The agent then connects via `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport`.

**Current flow:**

```
Plugin .mcp.json
  → parseMcpJson() [filters type==="http" only]
  → McpServerConfig { name, url, auth:"bearer" }
  → createMcpClientManager()
  → StreamableHTTPClientTransport
  → MCP Client ↔ remote HTTP MCP server
```

### What doesn't work

- **stdio MCP servers** (the most common type — spawned as child processes) cannot run in the sandbox because the sandbox has no persistent-process API.
- **SSE / WebSocket MCP servers** running inside the sandbox cannot be connected to because the MCP client only supports Streamable HTTP.
- The plugin parser (`parseMcpJson`) silently drops any non-HTTP entries.

### Root cause: three layers are blocked

| Layer | File | Issue |
|-------|------|-------|
| Plugin parsing | `src/plugins/parse.ts:114-129` | `.filter(type === "http")` drops stdio/SSE entries |
| MCP client | `src/mcp/client-manager.ts:235-237` | Only uses `StreamableHTTPClientTransport` |
| **Sandbox interface** | `src/sandbox/types.ts` | `exec()` is one-shot (run→collect→return). No `spawn()` for long-running processes with bidirectional stdin/stdout streaming. **This is the real blocker.** |

---

## Chosen Approach: Add `spawn()` primitive to Sandbox (方案 A)

Instead of injecting an HTTP bridge inside the sandbox to work around the limitation, we extend the sandbox abstraction to support persistent processes with bidirectional I/O. This is the clean solution — the sandbox should support all forms of process interaction, not just one-shot commands.

---

## Design

### 1. New Sandbox primitive: `spawn()`

Add to `SandboxIO` in `src/sandbox/types.ts`:

```typescript
export type SpawnedProcess = {
  readonly pid: number;
  readonly stdin: WritableStream<Uint8Array>;  // write JSON-RPC to MCP server
  readonly stdout: ReadableStream<Uint8Array>; // read JSON-RPC from MCP server
  readonly stderr: ReadableStream<Uint8Array>; // diagnostics / logging
  readonly exited: Promise<number>;            // resolves with exit code when process ends
  kill(signal?: string): Promise<void>;        // graceful shutdown
};

export type SpawnOptions = {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // optional max lifetime in ms
};

export interface SandboxIO {
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;       // existing
  spawn(command: string, args?: string[], opts?: SpawnOptions): Promise<SpawnedProcess>; // NEW
  file: { /* unchanged */ };
}
```

Key design points:
- Uses Web Streams API (`ReadableStream` / `WritableStream`) — standard, composable, backpressure-aware.
- `exited` promise lets callers await natural termination.
- `kill()` for explicit teardown (called during `sandbox.shutdown()`).

### 2. Provider implementations

#### E2B (`src/sandbox/providers/e2b.ts`)

E2B SDK supports persistent processes via `sandbox.commands.run()` with streaming callbacks, but the more appropriate primitive is `sandbox.commands.exec()` or the PTY interface. Investigate:
- `sandbox.pty.create()` — gives full bidirectional terminal I/O
- Or use `sandbox.commands.run()` with `background: true` + `onStdout`/`onStderr` streams
- Need to verify E2B SDK supports writing to stdin of a running process

#### Kubernetes (`src/sandbox/providers/kubernetes.ts`)

K8s sandbox uses port-forwarded HTTP to an `execd` sidecar. Options:
- Extend `execd` to support a `/process/spawn` endpoint that returns a WebSocket for bidirectional stdin/stdout streaming
- Or use `kubectl exec` with stdin attached (`-i` flag) via the K8s API (`@kubernetes/client-node` exec)

### 3. Extend MCP config types

**`src/agent/types.ts`** — union type:

```typescript
export type McpServerConfig =
  | { name: string; type: "http"; url: string; auth?: "bearer" }
  | { name: string; type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { name: string; type: "sse"; url: string; auth?: "bearer" };
```

**`src/schema/bundle.ts`** — zod schema needs a discriminated union on `type`.

**`src/plugins/types.ts`** — `McpJsonEntry` already has `command`/`args`/`env` fields, they're just ignored.

### 4. Extend `parseMcpJson()`

**`src/plugins/parse.ts`** — remove the HTTP-only filter. Parse all types:

```typescript
export function parseMcpJson(json: string, sourceUrl: string): McpServerConfig[] {
  // ... parse JSON ...
  return Object.entries(servers).map(([name, config]) => {
    switch (config.type) {
      case "http":
        return { name, type: "http", url: config.url!, auth: "bearer" as const };
      case "stdio":
        return { name, type: "stdio", command: config.command!, args: config.args, env: config.env };
      case "sse":
        return { name, type: "sse", url: config.url!, auth: "bearer" as const };
      default:
        return null; // skip unknown types
    }
  }).filter(Boolean);
}
```

### 5. Extend MCP client manager

**`src/mcp/client-manager.ts`** — branch on transport type in `defaultConnectServer()`:

```typescript
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function connectServer(server: McpServerConfig, sandbox: Sandbox, token?: string) {
  switch (server.type) {
    case "http":
      return connectViaHttp(server, token);       // existing code
    case "stdio":
      return connectViaStdio(server, sandbox);    // NEW — uses sandbox.spawn()
    case "sse":
      return connectViaSse(server, token);        // NEW — SSEClientTransport
  }
}
```

For stdio, the connection flow is:
1. `sandbox.spawn(server.command, server.args, { env: server.env })`
2. Wrap the `SpawnedProcess.stdin`/`stdout` streams into what `StdioClientTransport` expects (or write a custom `Transport` that reads/writes to the spawned process streams)
3. `client.connect(transport)`

**Important**: The MCP SDK's `StdioClientTransport` expects a Node.js `ChildProcess`. Since we have Web Streams from the sandbox, we likely need a **custom `Transport` implementation** that adapts `SpawnedProcess` streams to the MCP SDK's `Transport` interface. The `Transport` interface is simple:

```typescript
interface Transport {
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;        // write to stdin
  close(): Promise<void>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;       // read from stdout
}
```

### 6. Lifecycle management

When the sandbox shuts down, all spawned MCP server processes must be killed:

```typescript
// In agent.ts shutdown sequence:
async shutdown() {
  await this.mcpClientManager?.closeAll();    // close MCP client connections
  // Each stdio connection's close() should call spawnedProcess.kill()
  await this.sandbox?.shutdown();              // then shutdown sandbox
}
```

---

## Files to modify

| File | Change |
|------|--------|
| `src/sandbox/types.ts` | Add `SpawnedProcess` type, `SpawnOptions` type, `spawn()` to `SandboxIO` |
| `src/sandbox/providers/e2b.ts` | Implement `spawn()` using E2B SDK |
| `src/sandbox/providers/kubernetes.ts` | Implement `spawn()` using K8s exec or extend execd |
| `src/agent/types.ts` | Expand `McpServerConfig` to discriminated union |
| `src/schema/bundle.ts` | Update zod schema for MCP server config |
| `src/plugins/types.ts` | Already has fields, may need minor type update |
| `src/plugins/parse.ts` | Remove HTTP-only filter, parse all transport types |
| `src/mcp/client-manager.ts` | Add stdio/SSE transport branches, accept sandbox dependency |
| **NEW** `src/mcp/sandbox-transport.ts` | Custom MCP `Transport` adapter for `SpawnedProcess` streams |
| `src/agent/agent.ts` | Pass sandbox to MCP client manager creation |
| Tests | New tests for spawn(), sandbox-transport, updated parseMcpJson |

---

## Implementation order (suggested)

1. **`src/sandbox/types.ts`** — define `SpawnedProcess`, `SpawnOptions`, add `spawn()` to interface
2. **E2B provider** — implement `spawn()` (start here, easiest to test locally)
3. **`src/mcp/sandbox-transport.ts`** — custom Transport wrapping SpawnedProcess streams
4. **Type expansion** — `McpServerConfig` union, zod schema, `parseMcpJson()`
5. **`src/mcp/client-manager.ts`** — transport branching logic
6. **`src/agent/agent.ts`** — wire sandbox into MCP manager, lifecycle cleanup
7. **K8s provider** — implement `spawn()` (can defer if E2B is the priority)
8. **Tests** — unit tests for each layer

---

## Implementation Notes

1. E2B `spawn()` is implemented through `sandbox.commands.run(..., { background: true, stdin: true })` with `sendStdin` for writable stdin and callback-backed stdout/stderr streams.
2. Kubernetes `spawn()` uses execd `/process/spawn` over WebSocket with JSON message framing (`stdin`, `stdin-close`, `kill`, `stdout`, `stderr`, `exit`, `error`).
3. MCP stdio transport is implemented via a sandbox-native transport adapter that reads/writes newline-delimited JSON-RPC over `SpawnedProcess` streams.
4. MCP server config now supports discriminated transport types (`http`, `stdio`, `sse`) in schema, plugin parsing, and runtime connection management.
5. Client manager now branches transport by server type and requires a sandbox for stdio servers.

## Open questions

1. **E2B SDK**: Does `sandbox.pty.create()` or `sandbox.commands.run({ background: true })` give us writable stdin? Need to verify API surface.
2. **K8s execd**: Should we extend the execd sidecar with a WebSocket `/spawn` endpoint, or use the K8s API `exec` directly with stdin?
3. **Web Streams vs Node Streams**: The MCP SDK internally uses Node.js streams. Should `SpawnedProcess` use Node `Readable`/`Writable` instead of Web Streams for easier interop? Tradeoff: Web Streams are more standard but need adaptation.
4. **Port-based transports (SSE, HTTP) inside sandbox**: For MCP servers that listen on a port inside the sandbox, do we need the sandbox to expose/forward that port, or is `spawn()` + stdio sufficient for all cases?
5. **Multiple stdio servers**: How to manage multiple spawned processes — one per MCP server? Need to ensure all are tracked and cleaned up.

---

## References

- MCP Spec transports: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- `@modelcontextprotocol/sdk` Transport interface: https://www.npmjs.com/package/@modelcontextprotocol/sdk
- E2B SDK docs: https://e2b.dev/docs
- Current codebase entry points: `src/sandbox/types.ts`, `src/mcp/client-manager.ts`, `src/plugins/parse.ts`
