# Agent Bundle Implementation Plan

## Scope Extraction (from `docs/proposal.md`)

### In-scope goals
1. YAML-driven bundle declaration for skills/model/permissions.
2. Two modes:
   - `serve`: local process for dev/test.
   - `build`: produce deployable Docker image.
3. Built-in runtime in both modes:
   - simple agent loop.
   - basic local sandbox service.
4. Service interfaces:
   - minimal OpenAI-style Chat Completions endpoint.
   - MCP server.
   - terminal/TUI + lightweight chat UI in `serve` mode only.
5. Token/model consumption strategy configurable by user.

### Out of scope / constraints
1. No token provisioning.
2. Runtime is stateless.
3. No deep malicious-skill validation in this scope.
4. No cloud deployment orchestration beyond image artifact.
5. Advanced permission model and pluggable agent loops are future work.

## Execution Plan

### Phase 1: Foundation
- Create Python package layout and CLI entrypoint.
- Define bundle YAML schema and loader with validation.
- Create example bundle config for local run.

Exit criteria:
- `agent-bundle --help` works.
- Config parse unit tests pass.

### Phase 2: Runtime Core
- Implement Skill Manager:
  - discover skills from local directories.
  - parse `SKILL.md` + basic metadata.
- Implement basic sandbox service:
  - scoped workspace root.
  - optional shell execution allow/deny switch.
- Implement simple agent loop:
  - skill matching by keyword score.
  - provider call with selected skills context.
  - structured response payload.

Exit criteria:
- Unit tests validate discovery + routing.

### Phase 3: Provider Layer
- Add provider abstraction + adapters:
  - OpenAI-compatible endpoint adapter (for OpenAI/LiteLLM/OpenRouter/etc.).
  - Anthropic adapter.
  - Gemini adapter.
  - local dummy provider for offline tests.
- Keep model and token params externally configurable from YAML.

Exit criteria:
- Provider selection tests pass using dummy/mocked transports.

### Phase 4: Service Interfaces
- Build HTTP service with:
  - `POST /v1/chat/completions` (OpenAI-style subset).
  - MCP JSON-RPC endpoint with minimal methods (`initialize`, `tools/list`, `tools/call`).
- Add serve-only UX:
  - terminal chat REPL.
  - lightweight browser chat page.

Exit criteria:
- API tests for both chat and MCP pass.
- Manual local smoke run works.

### Phase 5: Build Mode
- Implement `build` command to package runtime into Docker image via YAML config.
- Generate Dockerfile and include bundle assets.
- Support dry-run build plan and actual `docker build`.

Exit criteria:
- Build command creates deterministic context.
- If Docker exists, image builds successfully.

### Phase 6: Validation and Report
- Add/complete test suite + run.
- Write test report with:
  - test matrix and outcomes.
  - evidence of scope coverage.
  - design rationale and trade-offs.
  - known limits and future work.
- If gaps found, patch code and rerun tests.

Exit criteria:
- Test report in repo with reproducible commands and results.

## Quality Gates for this task
- Keep modules focused and typed.
- Keep defaults safe and explicit.
- Ensure failure messages are actionable.
- Prefer deterministic outputs for tests and build context generation.

## Execution Status

- [x] Phase 1 completed: package layout, CLI, config schema, sample bundle.
- [x] Phase 2 completed: skill manager, sandbox service, agent loop.
- [x] Phase 3 completed: provider abstraction + adapters (dummy/openai-compatible/anthropic/gemini).
- [x] Phase 4 completed: chat completions API, MCP endpoint, terminal chat mode, lightweight web chat UI.
- [x] Phase 5 completed: Dockerfile generation + `build` command with dry-run and actual build path.
- [x] Phase 6 completed: automated tests, command smoke tests, pre-commit run, and written evidence report.

## Execution Notes

- During command smoke validation, example config path resolution was incorrect (`examples/examples/skills`).
- Fix applied by updating `examples/bundle.yaml` to use config-relative paths:
  - `skills.paths: ./skills`
  - `permissions.workspace_root: ..`
  - `build.context: ..`
  - `build.dockerfile: ../Dockerfile.agent-bundle`
- After the fix, tests and command validation were re-run successfully.
- Docker availability was verified and real image build/container smoke test completed successfully (`demo-agent-bundle:test`).
