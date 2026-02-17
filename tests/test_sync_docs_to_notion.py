from __future__ import annotations

import io
import json
import os
import subprocess
from email.message import Message
from pathlib import Path
from typing import Any, Literal, cast
from urllib import error

import pytest
import scripts.sync_docs_to_notion as sync


def test_normalize_notion_id_formats() -> None:
    assert (
        sync.normalize_notion_id("30ab3f79b3b4810fbfc6d874eca9df02")
        == "30ab3f79-b3b4-810f-bfc6-d874eca9df02"
    )
    assert (
        sync.normalize_notion_id("30ab3f79-b3b4-810f-bfc6-d874eca9df02")
        == "30ab3f79-b3b4-810f-bfc6-d874eca9df02"
    )
    assert (
        sync.normalize_notion_id("docs-30ab3f79b3b4810fbfc6d874eca9df02")
        == "30ab3f79-b3b4-810f-bfc6-d874eca9df02"
    )
    assert sync.normalize_notion_id("not-a-valid-id") is None


def test_set_frontmatter_value_add_and_update() -> None:
    original = "---\ntitle: Test\n---\n\n# Heading\n"
    updated = sync.set_frontmatter_value(original, "notion_page_id", "abc")
    assert 'notion_page_id: "abc"' in updated

    replaced = sync.set_frontmatter_value(updated, "notion_page_id", "def")
    assert 'notion_page_id: "def"' in replaced
    assert 'notion_page_id: "abc"' not in replaced


def test_markdown_title_priority() -> None:
    with_frontmatter = "---\ntitle: My Title\n---\n\n# Heading\n"
    assert sync.markdown_title(with_frontmatter, "docs/file.md") == "My Title"

    with_heading = "# First\n\nBody"
    assert sync.markdown_title(with_heading, "docs/file.md") == "First"

    no_title = "Body only"
    assert sync.markdown_title(no_title, "docs/my_file-name.md") == "my file name"


def test_to_rich_text_supports_inline_code() -> None:
    items = sync.to_rich_text("use `python` here")
    assert len(items) >= 2
    assert any(item.get("annotations", {}).get("code") for item in items)


def test_markdown_to_blocks_nested_lists_and_quote() -> None:
    md = """
# Title

> top quote

1. Item one
   detail line
   > quoted detail
2. Item two
   - child bullet
""".strip()

    blocks = sync.markdown_to_blocks(md)
    assert blocks[0]["type"] == "heading_1"
    assert blocks[1]["type"] == "quote"

    first_item = blocks[2]
    assert first_item["type"] == "numbered_list_item"
    children = first_item["numbered_list_item"]["children"]
    assert children[0]["type"] == "paragraph"
    assert children[1]["type"] == "quote"

    second_item = blocks[3]
    assert second_item["type"] == "numbered_list_item"
    child_types = [c["type"] for c in second_item["numbered_list_item"]["children"]]
    assert "bulleted_list_item" in child_types


def test_build_operations_maps_changes() -> None:
    changes = [
        sync.Change(status="A", path="docs/a.md"),
        sync.Change(status="M", path="docs/b.md"),
        sync.Change(status="D", path="docs/c.md"),
        sync.Change(status="R100", old_path="docs/old.md", new_path="docs/new.md"),
        sync.Change(status="R100", old_path="other/a.md", new_path="docs/imported.md"),
    ]
    ops = sync.build_operations(changes)
    kinds = [(op.kind, op.path, op.old_path, op.new_path) for op in ops]
    assert ("upsert", "docs/a.md", None, None) in kinds
    assert ("upsert", "docs/b.md", None, None) in kinds
    assert ("delete", "docs/c.md", None, None) in kinds
    assert ("rename", None, "docs/old.md", "docs/new.md") in kinds
    assert ("upsert", "docs/imported.md", None, None) in kinds


def test_load_env_file_parses_lines(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_file = tmp_path / ".env.local"
    env_file.write_text(
        """
# comment
export FOO=bar
BAZ="qux"
INVALID
""".strip(),
        encoding="utf-8",
    )
    monkeypatch.delenv("FOO", raising=False)
    monkeypatch.delenv("BAZ", raising=False)

    sync.load_env_file(env_file)

    assert os.environ["FOO"] == "bar"
    assert os.environ["BAZ"] == "qux"


class FakeNotion:
    def __init__(self) -> None:
        self.created: list[tuple[str, str]] = []
        self.archived: list[str] = []

    def create_page(self, parent_page_id: str, title: str) -> str:
        self.created.append((parent_page_id, title))
        return "30ab3f79-b3b4-810f-bfc6-d874eca9df02"

    def archive_page(self, page_id: str) -> None:
        self.archived.append(page_id)


def test_handle_upsert_existing_id(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    staged = "---\ntitle: Title\nnotion_page_id: 30ab3f79b3b4810fbfc6d874eca9df02\n---\n\nBody"
    monkeypatch.setattr(sync, "read_staged_file", lambda _path: staged)

    called: dict[str, str] = {}

    def fake_sync_page_content(_notion: object, page_id: str, title: str, markdown: str) -> None:
        called["page_id"] = page_id
        called["title"] = title
        called["markdown"] = markdown

    monkeypatch.setattr(sync, "sync_page_content", fake_sync_page_content)

    class UpdateNotion(FakeNotion):
        def __init__(self) -> None:
            super().__init__()
            self.updated: list[tuple[str, str]] = []

        def update_page_title(self, page_id: str, title: str) -> None:
            self.updated.append((page_id, title))

    notion = UpdateNotion()
    op = sync.Operation(kind="upsert", path="docs/proposal.md")
    sync.handle_upsert(cast(Any, notion), op, "parent-id", tmp_path)

    assert called["page_id"] == "30ab3f79-b3b4-810f-bfc6-d874eca9df02"
    assert called["title"] == "Title"


def test_handle_upsert_creates_and_backfills(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    staged = "---\ntitle: Title\n---\n\nBody"
    monkeypatch.setattr(sync, "read_staged_file", lambda _path: staged)

    backfilled_markdown = staged + "\nnotion_page_id: added"
    monkeypatch.setattr(
        sync,
        "canonicalize_or_backfill_id",
        lambda _path, _staged, _id, _root: backfilled_markdown,
    )

    captured: dict[str, str] = {}
    monkeypatch.setattr(
        sync,
        "sync_page_content",
        lambda _n, page_id, _t, markdown: captured.update(
            {"page_id": page_id, "markdown": markdown}
        ),
    )

    notion = FakeNotion()
    op = sync.Operation(kind="upsert", path="docs/proposal.md")
    sync.handle_upsert(cast(Any, notion), op, "parent-id", tmp_path)

    assert notion.created == [("parent-id", "Title")]
    assert captured["page_id"] == "30ab3f79-b3b4-810f-bfc6-d874eca9df02"
    assert captured["markdown"] == backfilled_markdown


def test_handle_delete_archives(monkeypatch: pytest.MonkeyPatch) -> None:
    old = "---\nnotion_page_id: 30ab3f79b3b4810fbfc6d874eca9df02\n---\n"
    monkeypatch.setattr(sync, "read_head_file", lambda _path: old)

    notion = FakeNotion()
    sync.handle_delete(cast(Any, notion), sync.Operation(kind="delete", path="docs/a.md"))

    assert notion.archived == ["30ab3f79-b3b4-810f-bfc6-d874eca9df02"]


def test_handle_rename_conflicting_ids_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    old = "---\nnotion_page_id: 30ab3f79b3b4810fbfc6d874eca9df02\n---\n"
    new = "---\nnotion_page_id: 11111111-2222-3333-4444-555555555555\n---\n"
    monkeypatch.setattr(sync, "read_head_file", lambda _path: old)
    monkeypatch.setattr(sync, "read_staged_file", lambda _path: new)

    with pytest.raises(RuntimeError, match="conflicting notion_page_id"):
        sync.handle_rename(
            cast(Any, FakeNotion()),
            sync.Operation(kind="rename", old_path="docs/old.md", new_path="docs/new.md"),
            "parent-id",
            tmp_path,
        )


def test_main_skips_when_not_main(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sync, "repo_root", lambda: tmp_path)
    monkeypatch.setattr(sync, "load_env_file", lambda _p: None)
    monkeypatch.setattr(sync, "current_branch", lambda: "feature")
    assert sync.main() == 0


def test_main_warns_and_skips_when_missing_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(sync, "repo_root", lambda: tmp_path)
    monkeypatch.setattr(sync, "load_env_file", lambda _p: None)
    monkeypatch.setattr(sync, "current_branch", lambda: "main")
    monkeypatch.setattr(
        sync,
        "build_operations",
        lambda _changes: [sync.Operation(kind="upsert", path="docs/a.md")],
    )
    monkeypatch.setattr(sync, "staged_changes", lambda: [sync.Change(status="A", path="docs/a.md")])
    monkeypatch.delenv("NOTION_TOKEN", raising=False)
    monkeypatch.delenv("NOTION_PARENT_PAGE_ID", raising=False)

    assert sync.main() == 0


def test_main_dispatches_handlers(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sync, "repo_root", lambda: tmp_path)
    monkeypatch.setattr(sync, "load_env_file", lambda _p: None)
    monkeypatch.setattr(sync, "current_branch", lambda: "main")
    monkeypatch.setattr(sync, "staged_changes", lambda: [sync.Change(status="A", path="docs/a.md")])
    monkeypatch.setattr(
        sync,
        "build_operations",
        lambda _changes: [
            sync.Operation(kind="upsert", path="docs/a.md"),
            sync.Operation(kind="delete", path="docs/b.md"),
            sync.Operation(kind="rename", old_path="docs/c.md", new_path="docs/d.md"),
        ],
    )

    class DummyNotion:
        def __init__(self, token: str, version: str) -> None:
            self.token = token
            self.version = version

    monkeypatch.setattr(sync, "NotionClient", DummyNotion)
    monkeypatch.setattr(sync, "normalize_notion_id", lambda raw: raw)

    calls: list[str] = []
    monkeypatch.setattr(sync, "handle_upsert", lambda *_: calls.append("upsert"))
    monkeypatch.setattr(sync, "handle_delete", lambda *_: calls.append("delete"))
    monkeypatch.setattr(sync, "handle_rename", lambda *_: calls.append("rename"))

    monkeypatch.setenv("NOTION_TOKEN", "token")
    monkeypatch.setenv("NOTION_PARENT_PAGE_ID", "parent-id")
    assert sync.main() == 0
    assert calls == ["upsert", "delete", "rename"]


def test_main_returns_error_on_exception(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sync, "repo_root", lambda: tmp_path)
    monkeypatch.setattr(sync, "load_env_file", lambda _p: None)
    monkeypatch.setattr(sync, "current_branch", lambda: "main")
    monkeypatch.setattr(sync, "staged_changes", lambda: [sync.Change(status="A", path="docs/a.md")])
    monkeypatch.setattr(
        sync,
        "build_operations",
        lambda _changes: [sync.Operation(kind="upsert", path="docs/a.md")],
    )

    class DummyNotion:
        def __init__(self, token: str, version: str) -> None:
            self.token = token
            self.version = version

    monkeypatch.setattr(sync, "NotionClient", DummyNotion)
    monkeypatch.setattr(sync, "normalize_notion_id", lambda raw: raw)
    monkeypatch.setattr(
        sync, "handle_upsert", lambda *_: (_ for _ in ()).throw(RuntimeError("boom"))
    )

    monkeypatch.setenv("NOTION_TOKEN", "token")
    monkeypatch.setenv("NOTION_PARENT_PAGE_ID", "parent-id")
    assert sync.main() == 1


def test_request_json_success(monkeypatch: pytest.MonkeyPatch) -> None:
    class DummyResponse:
        def __enter__(self) -> "DummyResponse":
            return self

        def __exit__(self, exc_type: object, exc: object, tb: object) -> Literal[False]:
            return False

        def read(self) -> bytes:
            return json.dumps({"ok": True}).encode("utf-8")

    monkeypatch.setattr(sync.request, "urlopen", lambda *_args, **_kwargs: DummyResponse())

    client = sync.NotionClient(token="token", version="2022-06-28")
    result = client.request_json("GET", "/users/me")
    assert result == {"ok": True}


def test_request_json_http_error_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_http_error(*_args: object, **_kwargs: object) -> object:
        headers = Message()
        raise error.HTTPError(
            url="https://example.com",
            code=400,
            msg="bad request",
            hdrs=headers,
            fp=io.BytesIO(b'{"message":"invalid"}'),
        )

    monkeypatch.setattr(sync.request, "urlopen", raise_http_error)
    client = sync.NotionClient(token="token", version="2022-06-28")

    with pytest.raises(sync.NotionAPIError, match="invalid"):
        client.request_json("GET", "/users/me", retries=1)


def test_request_json_retries_on_429(monkeypatch: pytest.MonkeyPatch) -> None:
    class DummyResponse:
        def __enter__(self) -> "DummyResponse":
            return self

        def __exit__(self, exc_type: object, exc: object, tb: object) -> Literal[False]:
            return False

        def read(self) -> bytes:
            return b'{"ok": true}'

    call_count = {"n": 0}

    def flaky_urlopen(*_args: object, **_kwargs: object) -> object:
        call_count["n"] += 1
        if call_count["n"] == 1:
            headers = Message()
            headers["Retry-After"] = "0"
            raise error.HTTPError(
                url="https://example.com",
                code=429,
                msg="rate limit",
                hdrs=headers,
                fp=io.BytesIO(b'{"message":"rate limited"}'),
            )
        return DummyResponse()

    monkeypatch.setattr(sync.request, "urlopen", flaky_urlopen)
    monkeypatch.setattr(sync.time, "sleep", lambda _seconds: None)
    client = sync.NotionClient(token="token", version="2022-06-28")

    assert client.request_json("GET", "/users/me", retries=2) == {"ok": True}
    assert call_count["n"] == 2


def test_request_json_url_error_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        sync.request,
        "urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(error.URLError("offline")),
    )
    monkeypatch.setattr(sync.time, "sleep", lambda _seconds: None)

    client = sync.NotionClient(token="token", version="2022-06-28")
    with pytest.raises(sync.NotionAPIError, match="network error"):
        client.request_json("GET", "/users/me", retries=1)


def test_notion_client_page_operations(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, dict | None]] = []

    def fake_request_json(
        self: sync.NotionClient,
        method: str,
        path: str,
        payload: dict | None = None,
        query: dict | None = None,
        retries: int = 3,
    ) -> dict:
        del self, query, retries
        calls.append((method, path, payload))
        if method == "POST" and path == "/pages":
            return {"id": "30ab3f79-b3b4-810f-bfc6-d874eca9df02"}
        return {}

    monkeypatch.setattr(sync.NotionClient, "request_json", fake_request_json)
    client = sync.NotionClient(token="token", version="2022-06-28")

    page_id = client.create_page("parent-id", "Title")
    client.update_page_title(page_id, "New Title")
    client.archive_page(page_id)

    assert page_id == "30ab3f79-b3b4-810f-bfc6-d874eca9df02"
    assert calls[0][0:2] == ("POST", "/pages")
    assert calls[1][0:2] == ("PATCH", f"/pages/{page_id}")
    assert calls[2][0:2] == ("PATCH", f"/pages/{page_id}")


def test_notion_client_replace_page_content(monkeypatch: pytest.MonkeyPatch) -> None:
    recorded: list[tuple[str, str, dict | None, dict | None]] = []
    responses = [
        {"results": [{"id": "a"}], "has_more": True, "next_cursor": "cursor-1"},
        {"results": [{"id": "b"}], "has_more": False},
        {},
        {},
        {},
    ]

    def fake_request_json(
        self: sync.NotionClient,
        method: str,
        path: str,
        payload: dict | None = None,
        query: dict | None = None,
        retries: int = 3,
    ) -> dict:
        del self, retries
        recorded.append((method, path, payload, query))
        return responses.pop(0)

    monkeypatch.setattr(sync.NotionClient, "request_json", fake_request_json)
    client = sync.NotionClient(token="token", version="2022-06-28")

    blocks = [sync.make_text_block("paragraph", "hello")]
    client.replace_page_content("page-id", blocks)

    assert recorded[0][0:2] == ("GET", "/blocks/page-id/children")
    assert recorded[1][0:2] == ("GET", "/blocks/page-id/children")
    assert recorded[2][0:2] == ("PATCH", "/blocks/a")
    assert recorded[3][0:2] == ("PATCH", "/blocks/b")
    assert recorded[4][0:2] == ("PATCH", "/blocks/page-id/children")


def test_markdown_to_blocks_empty_and_code_block() -> None:
    empty_blocks = sync.markdown_to_blocks("")
    assert empty_blocks[0]["type"] == "paragraph"

    code_blocks = sync.markdown_to_blocks("```\nprint('x')\n```")
    assert code_blocks[0]["type"] == "code"
    assert code_blocks[0]["code"]["language"] == "plain text"

    mermaid_blocks = sync.markdown_to_blocks("```mermaid\ngraph TD\nA-->B\n```")
    assert mermaid_blocks[0]["type"] == "code"
    assert mermaid_blocks[0]["code"]["language"] == "mermaid"

    mermaid_compatible = sync.markdown_to_blocks(
        '```mermaid\ngraph TD\nA["Line\\nTwo"]\nA & B -->|request| C\n```'
    )
    rendered = "".join(
        item["text"]["content"] for item in mermaid_compatible[0]["code"]["rich_text"]
    )
    assert "Line<br/>Two" in rendered
    assert "A -->|request| C" in rendered
    assert "B -->|request| C" in rendered


def test_staged_changes_parses_z_output(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = b"A\x00docs/a.md\x00M\x00docs/b.md\x00R100\x00docs/old.md\x00docs/new.md\x00"

    monkeypatch.setattr(
        sync,
        "run_git",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=["git"], returncode=0, stdout=payload, stderr=b""
        ),
    )

    changes = sync.staged_changes()
    assert [c.status for c in changes] == ["A", "M", "R100"]
    assert changes[2].old_path == "docs/old.md"
    assert changes[2].new_path == "docs/new.md"


def test_run_git_raises_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        sync.subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=["git"], returncode=1, stdout="nope", stderr="fail"
        ),
    )

    with pytest.raises(RuntimeError, match="failed"):
        sync.run_git(["status"])


def test_handle_rename_reuses_old_id(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    old_markdown = "---\nnotion_page_id: 30ab3f79b3b4810fbfc6d874eca9df02\n---\n"
    new_markdown = "---\ntitle: New Title\n---\n\nBody"
    monkeypatch.setattr(sync, "read_head_file", lambda _path: old_markdown)
    monkeypatch.setattr(sync, "read_staged_file", lambda _path: new_markdown)

    monkeypatch.setattr(
        sync,
        "canonicalize_or_backfill_id",
        lambda _path, _staged, page_id, _root: f"with-id:{page_id}",
    )

    called: dict[str, str] = {}
    monkeypatch.setattr(
        sync,
        "sync_page_content",
        lambda _n, page_id, title, markdown: called.update(
            {"page_id": page_id, "title": title, "markdown": markdown}
        ),
    )

    sync.handle_rename(
        cast(Any, FakeNotion()),
        sync.Operation(kind="rename", old_path="docs/old.md", new_path="docs/new.md"),
        "parent-id",
        tmp_path,
    )
    assert called["page_id"] == "30ab3f79-b3b4-810f-bfc6-d874eca9df02"
    assert called["title"] == "New Title"


def test_main_rejects_invalid_parent_id(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sync, "repo_root", lambda: tmp_path)
    monkeypatch.setattr(sync, "load_env_file", lambda _p: None)
    monkeypatch.setattr(sync, "current_branch", lambda: "main")
    monkeypatch.setattr(sync, "staged_changes", lambda: [sync.Change(status="A", path="docs/a.md")])
    monkeypatch.setattr(
        sync,
        "build_operations",
        lambda _changes: [sync.Operation(kind="upsert", path="docs/a.md")],
    )
    monkeypatch.setattr(sync, "normalize_notion_id", lambda _raw: None)
    monkeypatch.setenv("NOTION_TOKEN", "token")
    monkeypatch.setenv("NOTION_PARENT_PAGE_ID", "bad-id")

    assert sync.main() == 1
