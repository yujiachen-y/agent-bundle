#!/usr/bin/env python3
"""Sync staged docs changes to Notion when committing on main."""

from __future__ import annotations

import json
import os
import re
import subprocess  # nosec B404 - subprocess is required for scoped git CLI usage.
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Literal, Optional, overload
from urllib import error, parse, request

DEFAULT_NOTION_VERSION = "2022-06-28"
ENV_FILE = ".env.local"
DOCS_PREFIX = "docs/"
LOG_PREFIX = "[docs-notion-sync]"

FRONTMATTER_PATTERN = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
UUID_RE = re.compile(
    r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
)
HEX32_RE = re.compile(r"([0-9a-fA-F]{32})")
LIST_ITEM_RE = re.compile(r"^(\s*)([-*+]|\d+\.)\s+(.*)$")
INLINE_CODE_RE = re.compile(r"`([^`]+)`")
QUOTE_LINE_RE = re.compile(r"^\s*>\s?(.*)$")
CODE_FENCE_RE = re.compile(r"^\s*```(?P<lang>[^\s`]+)?\s*$")
NOTION_CODE_LANGUAGES = {"bash", "json", "markdown", "mermaid", "plain text", "python", "yaml"}
MERMAID_MULTI_SOURCE_EDGE_RE = re.compile(
    r"^(\s*)([A-Za-z_][A-Za-z0-9_]*(?:\s*&\s*[A-Za-z_][A-Za-z0-9_]*)+)\s*-->\s*(.+)$"
)
CODE_LANGUAGE_ALIASES = {
    "plaintext": "plain text",
    "text": "plain text",
    "yml": "yaml",
}


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


class NotionAPIError(RuntimeError):
    """Raised when a Notion API call fails."""


class NotionClient:
    def __init__(self, token: str, version: str) -> None:
        self.token = token
        self.version = version

    def request_json(
        self,
        method: str,
        path: str,
        payload: Optional[dict] = None,
        query: Optional[dict] = None,
        retries: int = 3,
    ) -> dict:
        url = f"https://api.notion.com/v1{path}"
        if query:
            url = f"{url}?{parse.urlencode(query)}"

        headers = {
            "Authorization": f"Bearer {self.token}",
            "Notion-Version": self.version,
            "Content-Type": "application/json",
        }

        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")

        for attempt in range(retries):
            req = request.Request(url, data=body, method=method, headers=headers)
            try:
                with request.urlopen(req, timeout=30) as resp:  # nosec B310
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw) if raw else {}
            except error.HTTPError as exc:
                raw_err = exc.read().decode("utf-8", "replace")
                if exc.code in {429, 500, 502, 503, 504} and attempt < retries - 1:
                    sleep_seconds = 1.0
                    if exc.code == 429:
                        retry_after = exc.headers.get("Retry-After")
                        if retry_after:
                            try:
                                sleep_seconds = max(0.5, float(retry_after))
                            except ValueError:
                                sleep_seconds = 1.0
                    time.sleep(sleep_seconds)
                    continue

                message = raw_err
                try:
                    parsed = json.loads(raw_err)
                    message = parsed.get("message", raw_err)
                except json.JSONDecodeError:
                    pass
                raise NotionAPIError(f"{method} {path} failed ({exc.code}): {message}") from exc
            except error.URLError as exc:
                if attempt < retries - 1:
                    time.sleep(1.0)
                    continue
                reason = getattr(exc, "reason", "unknown")
                raise NotionAPIError(f"{method} {path} network error: {reason}") from exc

        raise NotionAPIError(f"{method} {path} failed after retries")

    def create_page(self, parent_page_id: str, title: str) -> str:
        payload = {
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "properties": {
                "title": {
                    "title": [
                        {
                            "type": "text",
                            "text": {
                                "content": safe_text(title, fallback="Untitled")[:2000],
                            },
                        }
                    ]
                }
            },
        }
        data = self.request_json("POST", "/pages", payload)
        page_id = data.get("id")
        if not isinstance(page_id, str) or not page_id:
            raise NotionAPIError("POST /pages succeeded but no page id returned")
        return page_id

    def update_page_title(self, page_id: str, title: str) -> None:
        payload = {
            "properties": {
                "title": {
                    "title": [
                        {
                            "type": "text",
                            "text": {
                                "content": safe_text(title, fallback="Untitled")[:2000],
                            },
                        }
                    ]
                }
            }
        }
        self.request_json("PATCH", f"/pages/{page_id}", payload)

    def archive_page(self, page_id: str) -> None:
        self.request_json("PATCH", f"/pages/{page_id}", {"archived": True})

    def list_child_ids(self, block_id: str) -> list[str]:
        ids: list[str] = []
        cursor: str | None = None
        while True:
            query: dict[str, object] = {"page_size": 100}
            if cursor:
                query["start_cursor"] = cursor
            data = self.request_json("GET", f"/blocks/{block_id}/children", query=query)
            ids.extend(item["id"] for item in data.get("results", []))
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
        return ids

    def replace_page_content(self, page_id: str, blocks: list[dict]) -> None:
        child_ids = self.list_child_ids(page_id)
        for child_id in child_ids:
            self.request_json("PATCH", f"/blocks/{child_id}", {"archived": True})

        for batch in batched(blocks, 100):
            self.request_json(
                "PATCH",
                f"/blocks/{page_id}/children",
                {"children": batch},
            )


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


def build_operations(changes: list[Change]) -> list[Operation]:
    operations: list[Operation] = []
    seen: set[tuple[str, str, str]] = set()

    for change in changes:
        code = change.status[0]

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


def safe_text(text: str, fallback: str = " ") -> str:
    stripped = text.strip()
    return stripped if stripped else fallback


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


def to_rich_text(text: str) -> list[dict]:
    content = safe_text(text)
    rich_text: list[dict] = []
    max_len = 1800

    cursor = 0
    tokens: list[tuple[str, bool]] = []
    for match in INLINE_CODE_RE.finditer(content):
        if match.start() > cursor:
            tokens.append((content[cursor : match.start()], False))
        tokens.append((match.group(1), True))
        cursor = match.end()

    if cursor < len(content):
        tokens.append((content[cursor:], False))

    if not tokens:
        tokens.append((content, False))

    for raw_chunk, is_code in tokens:
        if not raw_chunk:
            continue

        for i in range(0, len(raw_chunk), max_len):
            chunk = raw_chunk[i : i + max_len]
            if not chunk:
                continue
            item: dict = {"type": "text", "text": {"content": chunk}}
            if is_code:
                item["annotations"] = {
                    "bold": False,
                    "italic": False,
                    "strikethrough": False,
                    "underline": False,
                    "code": True,
                    "color": "default",
                }
            rich_text.append(item)

    return rich_text or [{"type": "text", "text": {"content": " "}}]


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
            "rich_text": to_rich_text(text),
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

    blocks: list[dict] = []
    list_stack: list[tuple[int, dict]] = []
    in_code_block = False
    code_language = "plain text"
    code_lines: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\r")
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
        if stripped.startswith("### "):
            list_stack.clear()
            blocks.append(make_text_block("heading_3", stripped[4:].strip()))
            continue
        if stripped.startswith("## "):
            list_stack.clear()
            blocks.append(make_text_block("heading_2", stripped[3:].strip()))
            continue
        if stripped.startswith("# "):
            list_stack.clear()
            blocks.append(make_text_block("heading_1", stripped[2:].strip()))
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


def batched(items: list[dict], size: int) -> Iterable[list[dict]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


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


def validate_existing_notion_id(raw_id: str, path: str) -> str:
    normalized = normalize_notion_id(raw_id)
    if not normalized:
        raise RuntimeError(
            f"Invalid notion_page_id in {path}: {raw_id}. Expected 32-hex or UUID format."
        )
    return normalized


def canonicalize_or_backfill_id(
    path: str,
    staged_markdown: str,
    page_id: str,
    root: Path,
) -> str:
    updated = set_frontmatter_value(staged_markdown, "notion_page_id", page_id)
    write_and_stage_file(path, updated, root)
    info(f"Backfilled notion_page_id for {path}: {page_id}")
    return updated


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
    op: Operation,
    parent_page_id: str,
    root: Path,
) -> None:
    path = op.path
    if not path:
        raise RuntimeError("Invalid upsert operation: missing path")
    staged = read_staged_file(path)
    raw_id = extract_frontmatter_value(staged, "notion_page_id")
    title = markdown_title(staged, path)

    if raw_id:
        page_id = validate_existing_notion_id(raw_id, path)
        if raw_id != page_id:
            staged = canonicalize_or_backfill_id(path, staged, page_id, root)
        info(f"Updating Notion page for {path}: {page_id}")
    else:
        page_id = notion.create_page(parent_page_id, title)
        staged = canonicalize_or_backfill_id(path, staged, page_id, root)
        info(f"Created Notion page for {path}: {page_id}")

    sync_page_content(notion, page_id, title, staged)


def handle_delete(notion: NotionClient, op: Operation) -> None:
    path = op.path
    if not path:
        raise RuntimeError("Invalid delete operation: missing path")
    old_markdown = read_head_file(path)
    if old_markdown is None:
        warn(f"Cannot read {path} from HEAD; skip archive")
        return

    raw_id = extract_frontmatter_value(old_markdown, "notion_page_id")
    if not raw_id:
        warn(f"Deleted {path} has no notion_page_id; skip archive")
        return

    page_id = validate_existing_notion_id(raw_id, path)
    notion.archive_page(page_id)
    info(f"Archived Notion page for deleted doc {path}: {page_id}")


def handle_rename(
    notion: NotionClient,
    op: Operation,
    parent_page_id: str,
    root: Path,
) -> None:
    old_path = op.old_path
    new_path = op.new_path
    if not old_path or not new_path:
        raise RuntimeError("Invalid rename operation: missing old/new path")

    old_markdown = read_head_file(old_path)
    old_raw_id = extract_frontmatter_value(old_markdown, "notion_page_id") if old_markdown else None

    new_markdown = read_staged_file(new_path)
    new_raw_id = extract_frontmatter_value(new_markdown, "notion_page_id")

    old_id = validate_existing_notion_id(old_raw_id, old_path) if old_raw_id else None
    new_id = validate_existing_notion_id(new_raw_id, new_path) if new_raw_id else None

    if old_id and new_id and old_id != new_id:
        raise RuntimeError(
            f"Rename {old_path} -> {new_path} has conflicting notion_page_id "
            f"({old_id} vs {new_id})."
        )

    title = markdown_title(new_markdown, new_path)

    if old_id:
        page_id = old_id
        if not new_id:
            new_markdown = canonicalize_or_backfill_id(new_path, new_markdown, page_id, root)
        info(f"Renamed doc uses existing Notion page {page_id}: {old_path} -> {new_path}")
    elif new_id:
        page_id = new_id
        info(f"Rename fallback to existing new-file notion_page_id for {new_path}: {page_id}")
    else:
        page_id = notion.create_page(parent_page_id, title)
        new_markdown = canonicalize_or_backfill_id(new_path, new_markdown, page_id, root)
        info(f"Rename created new Notion page for {new_path}: {page_id}")

    sync_page_content(notion, page_id, title, new_markdown)


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

        for op in operations:
            if op.kind == "upsert":
                handle_upsert(notion, op, parent_page_id, root)
            elif op.kind == "delete":
                handle_delete(notion, op)
            elif op.kind == "rename":
                handle_rename(notion, op, parent_page_id, root)

        info("Docs sync to Notion completed")
        return 0
    except Exception as exc:  # noqa: BLE001
        fail(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
