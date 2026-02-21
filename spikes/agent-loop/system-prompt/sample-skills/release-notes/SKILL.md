---
name: release-notes
description: Draft release notes from git history and issue labels. Use when preparing weekly or versioned changelogs.
license: MIT
compatibility: git CLI
metadata:
  owner: developer-experience
---

# Release Notes

## Goal

Generate human-readable release notes grouped by feature area.

## Steps

1. Collect commit history between two refs.
2. Map commits to issue IDs and labels.
3. Group entries into sections (Features, Fixes, Breaking Changes).
4. Produce a markdown summary with links.

## Example

```bash
git log v1.2.0..HEAD --pretty=format:'%h%x09%s'
```

## Output

- A markdown file suitable for copy/paste to GitHub Releases.
- Include notable migration steps if breaking changes exist.
