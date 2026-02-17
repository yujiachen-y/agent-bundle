---
notion_page_id: "30ab3f79-b3b4-81b9-ad81-debda931fa0e"
---

# Infisical Setup

This repository uses environment variables for Notion integration:

- `NOTION_TOKEN`
- `NOTION_PARENT_PAGE_ID`
- `NOTION_API_VERSION` (optional, defaults to `2022-06-28`)

## One-time setup (manual)

```bash
brew install infisical/get-cli/infisical
infisical login
infisical init
```

If you are migrating existing local variables from `.env.local`:

```bash
infisical secrets set --env=dev --path=/ --file=.env.local
```

## Daily debug commands (Makefile)

List current env secrets:

```bash
make env-list ENV=dev
```

Run any command with injected env secrets:

```bash
make env-run ENV=dev CMD="python3 scripts/sync_docs_to_notion.py"
make env-run ENV=dev CMD="pre-commit run --all-files"
```

The `Makefile` intentionally only exposes `env-list` and `env-run`.
