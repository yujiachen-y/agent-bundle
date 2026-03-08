---
name: update-memory
description: Update a user profile memory from a new user event.
---

# Update Memory

When the user provides a new event or preference update:

1. Read the existing profile with `mcp__fs__read_file` from `/memory/<userId>.json`.
2. Merge the new event details into the existing profile object.
3. Write the merged profile with `mcp__fs__write_file` to `/memory/<userId>.json`.
4. Return a brief confirmation describing what was updated.

Rules:

- Never overwrite unrelated fields with empty values.
- Preserve existing profile keys unless the user explicitly changes them.
- If the profile file does not exist, create a new one with the event data.
- Always include an `updatedAt` ISO timestamp in the profile.
