---
doc_sync_id: "10db22c2-c922-4b83-940e-a6bfdc40b611"
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
