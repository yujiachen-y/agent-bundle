---
name: recommend
description: Generate ranked product recommendations from user profile memory.
---

# Recommend

When asked for recommendations:

1. Read the user profile with `mcp__fs__read_file` from `/memory/<userId>.json`.
2. Read the product catalog with `mcp__fs__read_file` from `/data/catalog.json`.
3. Return a ranked list of 3-5 recommendations with clear reasons.

Rules:

- Match recommendations to the user profile preferences and recent events.
- Exclude products that conflict with explicit dislikes when provided.
- If the user profile file does not exist, recommend popular or general items.
- Prefer concise, actionable explanations.
