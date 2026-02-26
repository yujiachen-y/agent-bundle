# Ollama TUI Demo

Interactive terminal demo: TUI prompt -> Agent -> E2B sandbox -> skill execution -> streamed response.

Uses Ollama as the model provider with a general-purpose coding assistant skill.

## Prerequisites

- Node.js >= 20 and pnpm
- [Ollama](https://ollama.com) running locally (`ollama serve`)
- A model pulled (default: `qwen2.5-coder`): `ollama pull qwen2.5-coder`
- `E2B_API_KEY` (for E2B sandbox + template build)

## Quick start

One command handles everything — Ollama check, E2B validation, bundle build, and TUI startup:

```bash
E2B_API_KEY=... pnpm demo:tui-ollama
```

The script is idempotent: on repeat runs, already-built templates are reused automatically.

### Changing the model

Edit `agent-bundle.yaml`:

```yaml
model:
  provider: ollama
  model: llama3.1    # any model available in your Ollama instance
```

Then pull the model (`ollama pull llama3.1`) and re-run the demo.

### Ollama configuration

The base URL defaults to `http://localhost:11434`. Override with `OLLAMA_BASE_URL` or `OLLAMA_HOST` environment variables if Ollama runs elsewhere.

## Usage

At the `> ` prompt, type a coding question:

```
> Write a Python function that checks if a number is prime and test it
```

The agent will write code to the sandbox, execute it, and stream the result back.

Press Ctrl+C once to interrupt a running response, twice to exit.

## Success criteria

1. Stream includes `[tool: ...]` indicators for sandbox operations.
2. Final output contains code executed in the E2B sandbox.
3. No cloud LLM API key required — runs entirely against local Ollama.
