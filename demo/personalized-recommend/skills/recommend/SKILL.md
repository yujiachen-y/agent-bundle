---
name: recommend
description: Generate ranked product recommendations from user profile memory.
---

# Recommend

When asked for recommendations:

1. Read the user profile with `mcp__memory__memory_read`.
2. Search candidate products with `mcp__products__product_search`.
3. Fetch specific product details with `mcp__products__product_detail` as needed.
4. Return a ranked list of 3-5 recommendations with clear reasons.

Rules:

- Match recommendations to the user profile preferences and recent events.
- Exclude products that conflict with explicit dislikes when provided.
- Prefer concise, actionable explanations.
