#!/usr/bin/env python3
"""Sync staged docs changes to Notion when committing on main."""

from __future__ import annotations

import os
import re
import subprocess  # nosec B404 - subprocess is required for scoped git CLI usage.
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Literal, Optional, overload

if TYPE_CHECKING:
    from scripts import markdown_rich_text as _markdown_rich_text
    from scripts import markdown_table as _markdown_table
    from scripts.notion_client import NotionAPIError as _NotionAPIError
    from scripts.notion_client import NotionClient as _NotionClient
    from scripts.notion_doc_index import STATUS_ACTIVE as _STATUS_ACTIVE
    from scripts.notion_doc_index import STATUS_ARCHIVED as _STATUS_ARCHIVED
    from scripts.notion_doc_index import NotionDocIndex as _NotionDocIndex
else:
    try:
        from scripts import markdown_rich_text as _markdown_rich_text
        from scripts import markdown_table as _markdown_table
        from scripts.notion_client import NotionAPIError as _NotionAPIError
        from scripts.notion_client import NotionClient as _NotionClient
        from scripts.notion_doc_index import STATUS_ACTIVE as _STATUS_ACTIVE
        from scripts.notion_doc_index import STATUS_ARCHIVED as _STATUS_ARCHIVED
        from scripts.notion_doc_index import NotionDocIndex as _NotionDocIndex
    except ImportError:
        import markdown_rich_text as _markdown_rich_text
        import markdown_table as _markdown_table
        from notion_client import NotionAPIError as _NotionAPIError
        from notion_client import NotionClient as _NotionClient
        from notion_doc_index import STATUS_ACTIVE as _STATUS_ACTIVE
        from notion_doc_index import STATUS_ARCHIVED as _STATUS_ARCHIVED
        from notion_doc_index import NotionDocIndex as _NotionDocIndex

to_rich_text = _markdown_rich_text.to_rich_text
parse_markdown_table = _markdown_table.parse_markdown_table
parse_heading_line = _markdown_table.parse_heading_line
NotionClient = _NotionClient
NotionAPIError = _NotionAPIError
NotionDocIndex = _NotionDocIndex
STATUS_ACTIVE = _STATUS_ACTIVE
STATUS_ARCHIVED = _STATUS_ARCHIVED

DEFAULT_NOTION_VERSION = "2022-06-28"
ENV_FILE = ".env.local"
DOCS_PREFIX = "docs/"
LOG_PREFIX = "[docs-notion-sync]"
DOC_SYNC_ID_KEY = "doc_sync_id"
LEGACY_NOTION_PAGE_ID_KEY = "notion_page_id"
SYNC_SCRIPT_TRIGGER_PATHS = {
    "scripts/markdown_table.py",
    "scripts/notion_doc_index.py",
    "scripts/markdown_rich_text.py",
    "scripts/sync_docs_to_notion.py",
}

FRONTMATTER_PATTERN = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
UUID_RE = re.compile(
    r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
)
HEX32_RE = re.compile(r"([0-9a-fA-F]{32})")
LIST_ITEM_RE = re.compile(r"^(\s*)([-*+]|\d+\.)\s+(.*)$")
QUOTE_LINE_RE = re.compile(r"^\s*>\s?(.*)$")
CODE_FENCE_RE = re.compile(r"^\s*```(?P<lang>[^\s`]+)?\s*$")
NOTION_CODE_LANGUAGES = {"bash", "json", "markdown", "mermaid", "plain text", "python", "yaml"}
MERMAID_MULTI_SOURCE_EDGE_RE = re.compile(
    r"^(\s*)([A-Za-z_][A-Za-z0-9_]*(?:\s*&\s*[A-Za-z_][A-Za-z0-9_]*)+)\s*-->\s*(.+)$"
)
CODE_LANGUAGE_ALIASES = {"plaintext": "plain text", "text": "plain text", "yml": "yaml"}


@dataclass
class Change:
    status: str
    path: Optional[str] = None
    old_path: Optional[str] = None
    new_path: Optional[str] = None


@dataclass
class Operation:
    kind: str
    path: Optional[str] = None
    old_path: Optional[str] = None
    new_path: Optional[str] = None


def info(msg: str) -> None:
    print(f"{LOG_PREFIX} {msg}")


def warn(msg: str) -> None:
    print(f"{LOG_PREFIX} WARNING: {msg}", file=sys.stderr)


def fail(msg: str) -> None:
    print(f"{LOG_PREFIX} ERROR: {msg}", file=sys.stderr)


@overload
def run_git(
    args: list[str], text: Literal[True] = True, check: bool = True
) -> subprocess.CompletedProcess[str]: ...


@overload
def run_git(
    args: list[str], text: Literal[False], check: bool = True
) -> subprocess.CompletedProcess[bytes]: ...


def run_git(
    args: list[str], text: bool = True, check: bool = True
) -> subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes]:
    # nosec: `git` command + args are controlled in code.
    proc = subprocess.run(  # nosec
        ["git", *args],
        capture_output=True,
        text=text,
        check=False,
    )
    if check and proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", "replace") if not text else proc.stderr
        stdout = proc.stdout.decode("utf-8", "replace") if not text else proc.stdout
        raise RuntimeError(
            f"git {' '.join(args)} failed ({proc.returncode})\nstdout: {stdout}\nstderr: {stderr}"
        )
    return proc


def repo_root() -> Path:
    root = run_git(["rev-parse", "--show-toplevel"]).stdout.strip()
    return Path(root)


def current_branch() -> str:
    return run_git(["branch", "--show-current"]).stdout.strip()


def staged_changes() -> list[Change]:
    proc = run_git(
        ["diff", "--cached", "--name-status", "--find-renames", "-z"],
        text=False,
    )
    raw = proc.stdout
    chunks = raw.split(b"\x00")

    changes: list[Change] = []
    i = 0
    while i < len(chunks) - 1:
        status_raw = chunks[i].decode("utf-8", "replace")
        i += 1
        if not status_raw:
            break

        code = status_raw[0]
        if code in {"R", "C"}:
            if i + 1 >= len(chunks):
                break
            old_path = chunks[i].decode("utf-8", "replace")
            new_path = chunks[i + 1].decode("utf-8", "replace")
            i += 2
            changes.append(Change(status=status_raw, old_path=old_path, new_path=new_path))
            continue

        if i >= len(chunks):
            break
        path = chunks[i].decode("utf-8", "replace")
        i += 1
        changes.append(Change(status=status_raw, path=path))

    return changes


def is_docs_path(path: str) -> bool:
    return path.startswith(DOCS_PREFIX)


def is_sync_script_path(path: str) -> bool:
    return path in SYNC_SCRIPT_TRIGGER_PATHS


def list_docs_paths_for_sync() -> list[str]:
    proc = run_git(["ls-files", "-z", "--", DOCS_PREFIX], text=False)
    chunks = proc.stdout.split(b"\x00")
    paths = [chunk.decode("utf-8", "replace") for chunk in chunks if chunk]
    return sorted(path for path in paths if is_docs_path(path))


def build_operations(changes: list[Change]) -> list[Operation]:
    operations: list[Operation] = []
    seen: set[tuple[str, str, str]] = set()
    sync_scripts_changed = False

    for change in changes:
        code = change.status[0]
        if code in {"A", "M", "D", "T"} and change.path and is_sync_script_path(change.path):
            sync_scripts_changed = True
        elif (
            code in {"R", "C"}
            and change.old_path
            and change.new_path
            and (is_sync_script_path(change.old_path) or is_sync_script_path(change.new_path))
        ):
            sync_scripts_changed = True

        if code in {"A", "M", "T"} and change.path and is_docs_path(change.path):
            op = Operation(kind="upsert", path=change.path)
        elif code == "D" and change.path and is_docs_path(change.path):
            op = Operation(kind="delete", path=change.path)
        elif code == "R" and change.old_path and change.new_path:
            old_docs = is_docs_path(change.old_path)
            new_docs = is_docs_path(change.new_path)
            if old_docs and new_docs:
                op = Operation(kind="rename", old_path=change.old_path, new_path=change.new_path)
            elif old_docs and not new_docs:
                op = Operation(kind="delete", path=change.old_path)
            elif new_docs and not old_docs:
                op = Operation(kind="upsert", path=change.new_path)
            else:
                continue
        else:
            continue

        key = (op.kind, op.path or op.old_path or "", op.new_path or "")
        if key in seen:
            continue
        seen.add(key)
        operations.append(op)

    if sync_scripts_changed:
        for path in list_docs_paths_for_sync():
            key = ("upsert", path, "")
            if key in seen:
                continue
            seen.add(key)
            operations.append(Operation(kind="upsert", path=path))

    return operations


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("export "):
            line = line[len("export ") :].strip()

        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]

        if key and key not in os.environ:
            os.environ[key] = value


def split_frontmatter(text: str) -> tuple[Optional[str], str]:
    match = FRONTMATTER_PATTERN.match(text)
    if not match:
        return None, text
    frontmatter = match.group(1)
    body = text[match.end() :]
    return frontmatter, body


def extract_frontmatter_value(text: str, key: str) -> Optional[str]:
    frontmatter, _ = split_frontmatter(text)
    if frontmatter is None:
        return None
    pattern = re.compile(rf"(?m)^\s*{re.escape(key)}\s*:\s*(.+?)\s*$")
    match = pattern.search(frontmatter)
    if not match:
        return None
    value = match.group(1).strip()
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        value = value[1:-1]
    return value.strip()


def strip_frontmatter(text: str) -> str:
    _, body = split_frontmatter(text)
    return body


def set_frontmatter_value(text: str, key: str, value: str) -> str:
    value_line = f'{key}: "{value}"'
    frontmatter, body = split_frontmatter(text)

    if frontmatter is None:
        body_clean = text.lstrip("\n")
        return f"---\n{value_line}\n---\n\n{body_clean}"

    lines = frontmatter.splitlines()
    key_pattern = re.compile(rf"^\s*{re.escape(key)}\s*:")
    replaced = False
    new_lines: list[str] = []

    for line in lines:
        if key_pattern.match(line):
            new_lines.append(value_line)
            replaced = True
        else:
            new_lines.append(line)

    if not replaced:
        new_lines.append(value_line)

    return "---\n" + "\n".join(new_lines) + "\n---\n" + body


def remove_frontmatter_key(text: str, key: str) -> str:
    frontmatter, body = split_frontmatter(text)
    if frontmatter is None:
        return text

    key_pattern = re.compile(rf"^\s*{re.escape(key)}\s*:")
    lines = frontmatter.splitlines()
    filtered = [line for line in lines if not key_pattern.match(line)]
    if len(filtered) == len(lines):
        return text
    if not filtered:
        return body.lstrip("\n")
    return "---\n" + "\n".join(filtered) + "\n---\n" + body


def normalize_doc_sync_id(value: str) -> Optional[str]:
    candidate = value.strip()
    try:
        return str(uuid.UUID(candidate))
    except ValueError:
        hex_match = HEX32_RE.search(candidate)
        if not hex_match:
            return None
        try:
            return str(uuid.UUID(hex_match.group(1)))
        except ValueError:
            return None


def normalize_notion_id(value: str) -> Optional[str]:
    candidate = value.strip()

    uuid_match = UUID_RE.search(candidate)
    if uuid_match:
        raw = uuid_match.group(1).replace("-", "").lower()
    else:
        hex_match = HEX32_RE.search(candidate)
        if not hex_match:
            return None
        raw = hex_match.group(1).lower()

    return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"


def extract_normalized_frontmatter_id(
    markdown: Optional[str],
    path: str,
    key: str,
    normalizer: Callable[[str], Optional[str]],
) -> Optional[str]:
    if markdown is None:
        return None
    raw = extract_frontmatter_value(markdown, key)
    if not raw:
        return None
    normalized = normalizer(raw)
    if not normalized:
        raise RuntimeError(f"Invalid {key} in {path}: {raw}")
    return normalized


def ensure_doc_sync_id(
    path: str, markdown: str, root: Path, preferred: Optional[str] = None
) -> tuple[str, str]:
    existing = extract_normalized_frontmatter_id(
        markdown, path, DOC_SYNC_ID_KEY, normalize_doc_sync_id
    )
    if existing and preferred and existing != preferred:
        raise RuntimeError(
            f"{path} has conflicting {DOC_SYNC_ID_KEY} ({existing} vs {preferred}) during rename."
        )
    doc_sync_id = preferred or existing or str(uuid.uuid4())
    updated = markdown
    if existing != doc_sync_id:
        updated = set_frontmatter_value(updated, DOC_SYNC_ID_KEY, doc_sync_id)
    updated = remove_frontmatter_key(updated, LEGACY_NOTION_PAGE_ID_KEY)
    if updated != markdown:
        write_and_stage_file(path, updated, root)
        info(f"Updated doc metadata for {path}: {DOC_SYNC_ID_KEY}={doc_sync_id}")
    return doc_sync_id, updated


def markdown_title(markdown: str, path: str) -> str:
    title = extract_frontmatter_value(markdown, "title")
    if title:
        return title

    body = strip_frontmatter(markdown)
    for raw in body.splitlines():
        line = raw.strip()
        if line.startswith("#"):
            heading = line.lstrip("#").strip()
            if heading:
                return heading

    fallback = Path(path).stem.replace("-", " ").replace("_", " ").strip()
    return fallback or "Untitled"


def make_text_block(block_type: str, text: str) -> dict:
    return {
        "object": "block",
        "type": block_type,
        block_type: {
            "rich_text": to_rich_text(text),
        },
    }


def normalize_code_language(language_hint: str | None) -> str:
    if not language_hint:
        return "plain text"
    normalized = language_hint.strip().lower()
    mapped = CODE_LANGUAGE_ALIASES.get(normalized, normalized)
    if mapped in NOTION_CODE_LANGUAGES:
        return mapped
    return "plain text"


def make_code_block(text: str, language: str = "plain text") -> dict:
    return {
        "object": "block",
        "type": "code",
        "code": {
            "rich_text": to_rich_text(text, parse_markdown=False),
            "language": language,
        },
    }


def normalize_code_content(text: str, language: str) -> str:
    if language != "mermaid":
        return text

    normalized = text.replace("\\n", "<br/>")
    lines: list[str] = []
    for raw_line in normalized.splitlines():
        match = MERMAID_MULTI_SOURCE_EDGE_RE.match(raw_line)
        if not match:
            lines.append(raw_line)
            continue
        indent, sources, target = match.groups()
        target_normalized = target.lstrip()
        spacer = "" if target_normalized.startswith("|") else " "
        for source in (item.strip() for item in sources.split("&")):
            lines.append(f"{indent}{source} -->{spacer}{target_normalized}")
    return "\n".join(lines)


def append_list_item(
    root_blocks: list[dict],
    stack: list[tuple[int, dict]],
    indent: int,
    block: dict,
) -> None:
    while stack and indent <= stack[-1][0]:
        stack.pop()

    if stack and indent > stack[-1][0]:
        parent = stack[-1][1]
        parent_type = parent["type"]
        parent_payload = parent[parent_type]
        children = parent_payload.setdefault("children", [])
        children.append(block)
    else:
        root_blocks.append(block)

    stack.append((indent, block))


def append_child_to_current_list_item(stack: list[tuple[int, dict]], block: dict) -> bool:
    if not stack:
        return False
    parent = stack[-1][1]
    parent_type = parent["type"]
    parent_payload = parent[parent_type]
    children = parent_payload.setdefault("children", [])
    children.append(block)
    return True


def markdown_to_blocks(markdown: str) -> list[dict]:
    text = strip_frontmatter(markdown).strip("\n")
    if not text:
        return [make_text_block("paragraph", "(empty document)")]

    lines = [raw.rstrip("\r") for raw in text.splitlines()]
    blocks: list[dict] = []
    list_stack: list[tuple[int, dict]] = []
    in_code_block = False
    code_language = "plain text"
    code_lines: list[str] = []
    skip_until = 0

    for line_no, line in enumerate(lines):
        if line_no < skip_until:
            continue
        expanded = line.expandtabs(4)
        stripped = expanded.strip()
        leading_spaces = len(expanded) - len(expanded.lstrip(" "))
        fence_match = CODE_FENCE_RE.match(expanded)
        if fence_match:
            if in_code_block:
                code_content = normalize_code_content("\n".join(code_lines), code_language)
                blocks.append(make_code_block(code_content, code_language))
                code_lines = []
                in_code_block = False
                code_language = "plain text"
            else:
                in_code_block = True
                code_language = normalize_code_language(fence_match.group("lang"))
            list_stack.clear()
            continue
        if in_code_block:
            code_lines.append(line)
            continue
        if not stripped:
            continue
        table_block, table_end = parse_markdown_table(lines, line_no, to_rich_text)
        if table_block is not None:
            list_stack.clear()
            blocks.append(table_block)
            skip_until = table_end
            continue
        heading_meta = parse_heading_line(stripped)
        if heading_meta:
            block_type, heading_text = heading_meta
            list_stack.clear()
            blocks.append(make_text_block(block_type, heading_text))
            continue
        quote_match = QUOTE_LINE_RE.match(expanded)
        if quote_match:
            quote_block = make_text_block("quote", quote_match.group(1).strip())
            if list_stack and leading_spaces > list_stack[-1][0]:
                append_child_to_current_list_item(list_stack, quote_block)
            else:
                list_stack.clear()
                blocks.append(quote_block)
            continue
        list_match = LIST_ITEM_RE.match(expanded)
        if list_match:
            indent = len(list_match.group(1))
            marker = list_match.group(2)
            content = list_match.group(3).strip()
            block_type = (
                "numbered_list_item"
                if marker.endswith(".") and marker[0].isdigit()
                else "bulleted_list_item"
            )
            append_list_item(
                root_blocks=blocks,
                stack=list_stack,
                indent=indent,
                block=make_text_block(block_type, content),
            )
            continue
        if list_stack and leading_spaces > list_stack[-1][0]:
            append_child_to_current_list_item(
                list_stack,
                make_text_block("paragraph", stripped),
            )
            continue
        list_stack.clear()
        blocks.append(make_text_block("paragraph", stripped))

    if in_code_block:
        code_content = normalize_code_content("\n".join(code_lines), code_language)
        blocks.append(make_code_block(code_content, code_language))

    return blocks or [make_text_block("paragraph", "(empty document)")]


def read_staged_file(path: str) -> str:
    proc = run_git(["show", f":{path}"], check=True)
    return proc.stdout


def read_head_file(path: str) -> Optional[str]:
    proc = run_git(["show", f"HEAD:{path}"], check=False)
    if proc.returncode != 0:
        return None
    return proc.stdout


def write_and_stage_file(path: str, content: str, root: Path) -> None:
    file_path = root / path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")
    run_git(["add", "--", path], check=True)


def extract_doc_sync_id(markdown: Optional[str], path: str) -> Optional[str]:
    return extract_normalized_frontmatter_id(markdown, path, DOC_SYNC_ID_KEY, normalize_doc_sync_id)


def extract_legacy_notion_page_id(markdown: Optional[str], path: str) -> Optional[str]:
    return extract_normalized_frontmatter_id(
        markdown,
        path,
        LEGACY_NOTION_PAGE_ID_KEY,
        normalize_notion_id,
    )


def resolve_page_id(
    *,
    indexed_page_id: Optional[str],
    legacy_page_id: Optional[str],
    path: str,
    doc_sync_id: str,
) -> Optional[str]:
    if indexed_page_id and legacy_page_id and indexed_page_id != legacy_page_id:
        raise RuntimeError(
            f"{path} has conflicting page mapping for {DOC_SYNC_ID_KEY}={doc_sync_id}: "
            f"index={indexed_page_id} legacy={legacy_page_id}"
        )
    return indexed_page_id or legacy_page_id


def sync_page_content(
    notion: NotionClient,
    page_id: str,
    title: str,
    markdown: str,
) -> None:
    notion.update_page_title(page_id, title)
    blocks = markdown_to_blocks(markdown)
    notion.replace_page_content(page_id, blocks)


def handle_upsert(
    notion: NotionClient,
    index: NotionDocIndex,
    op: Operation,
    parent_page_id: str,
    root: Path,
) -> None:
    path = op.path
    if not path:
        raise RuntimeError("Invalid upsert operation: missing path")
    staged = read_staged_file(path)
    legacy_page_id = extract_legacy_notion_page_id(staged, path)
    doc_sync_id, staged = ensure_doc_sync_id(path, staged, root)
    title = markdown_title(staged, path)
    record = index.find_by_doc_sync_id(doc_sync_id)
    page_id = resolve_page_id(
        indexed_page_id=record.notion_page_id if record else None,
        legacy_page_id=legacy_page_id,
        path=path,
        doc_sync_id=doc_sync_id,
    )

    if page_id:
        info(f"Updating Notion page for {path}: {page_id}")
    else:
        page_id = notion.create_page(parent_page_id, title)
        info(f"Created Notion page for {path}: {page_id}")

    sync_page_content(notion, page_id, title, staged)
    index.upsert(
        doc_sync_id=doc_sync_id,
        doc_path=path,
        notion_page_id=page_id,
        status=STATUS_ACTIVE,
        title=title,
    )


def handle_delete(notion: NotionClient, index: NotionDocIndex, op: Operation) -> None:
    path = op.path
    if not path:
        raise RuntimeError("Invalid delete operation: missing path")
    old_markdown = read_head_file(path)
    if old_markdown is None:
        warn(f"Cannot read {path} from HEAD; skip archive")
        return

    doc_sync_id = extract_doc_sync_id(old_markdown, path)
    legacy_page_id = extract_legacy_notion_page_id(old_markdown, path)
    record = index.find_by_doc_sync_id(doc_sync_id) if doc_sync_id else index.find_by_doc_path(path)
    page_id = resolve_page_id(
        indexed_page_id=record.notion_page_id if record else None,
        legacy_page_id=legacy_page_id,
        path=path,
        doc_sync_id=doc_sync_id or (record.doc_sync_id if record else "unknown"),
    )
    if not page_id:
        warn(f"Deleted {path} has no mapped Notion page; skip archive")
        return

    notion.archive_page(page_id)
    info(f"Archived Notion page for deleted doc {path}: {page_id}")
    known_sync_id = doc_sync_id or (record.doc_sync_id if record else None)
    if known_sync_id:
        index.upsert(
            doc_sync_id=known_sync_id,
            doc_path=path,
            notion_page_id=page_id,
            status=STATUS_ARCHIVED,
            title=Path(path).stem,
        )


def handle_rename(
    notion: NotionClient,
    index: NotionDocIndex,
    op: Operation,
    parent_page_id: str,
    root: Path,
) -> None:
    old_path = op.old_path
    new_path = op.new_path
    if not old_path or not new_path:
        raise RuntimeError("Invalid rename operation: missing old/new path")

    old_markdown = read_head_file(old_path)
    new_markdown = read_staged_file(new_path)
    old_doc_sync_id = extract_doc_sync_id(old_markdown, old_path)
    new_doc_sync_id = extract_doc_sync_id(new_markdown, new_path)
    if old_doc_sync_id and new_doc_sync_id and old_doc_sync_id != new_doc_sync_id:
        raise RuntimeError(
            f"Rename {old_path} -> {new_path} has conflicting {DOC_SYNC_ID_KEY} "
            f"({old_doc_sync_id} vs {new_doc_sync_id})."
        )
    old_legacy_id = extract_legacy_notion_page_id(old_markdown, old_path)
    new_legacy_id = extract_legacy_notion_page_id(new_markdown, new_path)
    if old_legacy_id and new_legacy_id and old_legacy_id != new_legacy_id:
        raise RuntimeError(
            f"Rename {old_path} -> {new_path} has conflicting {LEGACY_NOTION_PAGE_ID_KEY} "
            f"({old_legacy_id} vs {new_legacy_id})."
        )

    preferred_sync_id = new_doc_sync_id or old_doc_sync_id
    doc_sync_id, new_markdown = ensure_doc_sync_id(
        new_path,
        new_markdown,
        root,
        preferred=preferred_sync_id,
    )
    title = markdown_title(new_markdown, new_path)
    record = index.find_by_doc_sync_id(doc_sync_id)
    page_id = resolve_page_id(
        indexed_page_id=record.notion_page_id if record else None,
        legacy_page_id=new_legacy_id or old_legacy_id,
        path=new_path,
        doc_sync_id=doc_sync_id,
    )
    if page_id:
        info(f"Renamed doc uses existing Notion page {page_id}: {old_path} -> {new_path}")
    else:
        page_id = notion.create_page(parent_page_id, title)
        info(f"Rename created new Notion page for {new_path}: {page_id}")

    sync_page_content(notion, page_id, title, new_markdown)
    index.upsert(
        doc_sync_id=doc_sync_id,
        doc_path=new_path,
        notion_page_id=page_id,
        status=STATUS_ACTIVE,
        title=title,
    )


def main() -> int:
    try:
        root = repo_root()
        os.chdir(root)

        load_env_file(root / ENV_FILE)

        branch = current_branch()
        if branch != "main":
            info(f"Current branch is {branch}; skip Notion sync")
            return 0

        operations = build_operations(staged_changes())
        if not operations:
            info("No staged docs changes; skip Notion sync")
            return 0

        notion_token = os.getenv("NOTION_TOKEN", "").strip()
        parent_raw = os.getenv("NOTION_PARENT_PAGE_ID", "").strip()
        notion_version = os.getenv("NOTION_API_VERSION", DEFAULT_NOTION_VERSION).strip()

        if not notion_token or not parent_raw:
            warn("NOTION_TOKEN/NOTION_PARENT_PAGE_ID missing; skip docs sync for this commit")
            return 0

        parent_page_id = normalize_notion_id(parent_raw)
        if not parent_page_id:
            fail("NOTION_PARENT_PAGE_ID is invalid. Use a 32-hex or UUID page id.")
            return 1

        notion = NotionClient(notion_token, notion_version)
        index = NotionDocIndex(notion, parent_page_id)

        for op in operations:
            if op.kind == "upsert":
                handle_upsert(notion, index, op, parent_page_id, root)
            elif op.kind == "delete":
                handle_delete(notion, index, op)
            elif op.kind == "rename":
                handle_rename(notion, index, op, parent_page_id, root)

        info("Docs sync to Notion completed")
        return 0
    except Exception as exc:  # noqa: BLE001
        fail(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
