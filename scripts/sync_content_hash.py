"""Hash helpers for docs->Notion sync decisions."""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

SYNC_HASH_VERSION = "v1"
SYNC_LOGIC_FILES = (
    "sync_docs_to_notion.py",
    "markdown_codeblock.py",
    "markdown_rich_text.py",
    "markdown_table.py",
)


@lru_cache(maxsize=1)
def _sync_logic_fingerprint() -> str:
    hasher = hashlib.sha256()
    hasher.update(SYNC_HASH_VERSION.encode("utf-8"))
    root = Path(__file__).resolve().parent
    for rel in sorted(SYNC_LOGIC_FILES):
        path = root / rel
        hasher.update(rel.encode("utf-8"))
        try:
            hasher.update(path.read_bytes())
        except OSError:
            continue
    return hasher.hexdigest()


def hash_synced_markdown(markdown: str) -> str:
    hasher = hashlib.sha256()
    hasher.update(_sync_logic_fingerprint().encode("utf-8"))
    hasher.update(b"\n")
    hasher.update(markdown.encode("utf-8"))
    return hasher.hexdigest()
