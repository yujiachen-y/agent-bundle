---
name: update-memory
description: Update a user profile memory from a new user event.
---

# Update Memory

When the user provides a new event or preference update:

1. Call `mcp__memory__memory_read` with the user id.
2. Merge the new event details into the existing profile object.
3. Call `mcp__memory__memory_write` with the merged profile.
4. Return a brief confirmation describing what was updated.

Rules:

- Never overwrite unrelated fields with empty values.
- Preserve existing profile keys unless the user explicitly changes them.
- Include the user id in all memory tool calls.
