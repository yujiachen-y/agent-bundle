---
title: "Agent Bundle Proposal"
author: ""
createdAt: 2026-02-17
updatedAt: 2026-02-17
status: draft
notion_page_id: "30ab3f79-b3b4-810f-bfc6-d874eca9df02"
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

1. Skill Manager
   Discovers, loads, and manages Agent Skills from local directories or remote registries. Each skill runs within a scoped permission boundary controlling filesystem, network, and execution access. Detailed permission model design is deferred to a later stage.
2. Built-in Agent Loop
   A lightweight loop that handles skill matching, tool calling, and structured output for each incoming request.
3. LLM Provider Layer
   Supports major providers natively (Anthropic, OpenAI, Gemini) and accepts third-party provider proxies such as LiteLLM and OpenRouter. For local development and personal use, it also supports Ollama, Codex OAuth, and Claude `setup-token` for accessing local or third-party compute.
4. Service Interface
   Exposes a minimal external API surface (an OpenAI-style Chat Completions endpoint and an MCP server) for external integration. Encapsulates internal mechanics including agent-loop orchestration, sandbox management, and filesystem setup.

The runtime is packaged into a Docker image via a YAML-driven configuration, producing a single deployable artifact ready for cloud or local use.

## What This Is Not

Agent Bundle is not a wrapper around existing agent tools such as Claude Code, Codex, or Cursor. It does not embed or adapt third-party agent loops. Instead, it provides its own lightweight runtime purpose-built for loading and serving Agent Skills as deployable services.

## Goals and Non-Goals

### Goals

1. Provide a YAML-driven tool that declares a bundle (skills, model, permissions) and produces a runnable agent in two modes:
   - `serve` — runs as a local process for development and testing
   - `build` — produces a Docker image for online deployment
2. Include a simple, basic built-in runtime in both modes:
   - a simple Agent Loop for request execution
   - a basic local sandbox service
3. Expose built-in service interfaces appropriate to each mode:
   - a minimal Chat Completions-compatible interface and an MCP server (available in both modes)
   - terminal/TUI and lightweight chat UI (local `serve` mode only)
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

<!-- High-level architecture or design description. -->

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
