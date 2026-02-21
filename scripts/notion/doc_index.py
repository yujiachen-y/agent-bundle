"""Notion docs index helpers backed by a database under the parent page."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

INDEX_DATABASE_TITLE = "Docs Sync Index"
STATUS_ACTIVE = "active"
STATUS_ARCHIVED = "archived"


class NotionAPIProtocol(Protocol):
    def request_json(
        self,
        method: str,
        path: str,
        payload: dict | None = None,
        query: dict | None = None,
        retries: int = 3,
    ) -> dict: ...


@dataclass(frozen=True)
class DocIndexRecord:
    entry_page_id: str
    doc_sync_id: str
    doc_path: str
    notion_page_id: str
    status: str
    content_hash: str


def _text_property(text: str) -> dict:
    if not text:
        return {"rich_text": []}
    return {
        "rich_text": [
            {
                "type": "text",
                "text": {"content": text[:2000]},
            }
        ]
    }


def _title_property(text: str) -> dict:
    content = text.strip() or "Untitled"
    return {
        "title": [
            {
                "type": "text",
                "text": {"content": content[:2000]},
            }
        ]
    }


def _read_rich_text(properties: dict, key: str) -> str:
    prop = properties.get(key, {})
    rich = prop.get("rich_text", [])
    return "".join(item.get("plain_text", "") for item in rich).strip()


def _read_select(properties: dict, key: str) -> str:
    prop = properties.get(key, {})
    selected = prop.get("select")
    if not isinstance(selected, dict):
        return ""
    value = selected.get("name")
    return value if isinstance(value, str) else ""


def _to_record(item: dict) -> DocIndexRecord | None:
    entry_page_id = item.get("id")
    if not isinstance(entry_page_id, str) or not entry_page_id:
        return None
    properties = item.get("properties", {})
    if not isinstance(properties, dict):
        return None

    doc_sync_id = _read_rich_text(properties, "doc_sync_id")
    doc_path = _read_rich_text(properties, "doc_path")
    notion_page_id = _read_rich_text(properties, "notion_page_id")
    status = _read_select(properties, "status")
    content_hash = _read_rich_text(properties, "content_hash")
    if not doc_sync_id:
        return None

    return DocIndexRecord(
        entry_page_id=entry_page_id,
        doc_sync_id=doc_sync_id,
        doc_path=doc_path,
        notion_page_id=notion_page_id,
        status=status,
        content_hash=content_hash,
    )


class NotionDocIndex:
    def __init__(self, notion: NotionAPIProtocol, parent_page_id: str) -> None:
        self.notion = notion
        self.parent_page_id = parent_page_id
        self.database_id: str | None = None
        self.schema_checked = False
        self._cache: dict[str, DocIndexRecord] | None = None
        self._path_cache: dict[str, DocIndexRecord] | None = None
        self._lock = threading.Lock()

    def _ensure_schema(self, database_id: str) -> None:
        if self.schema_checked:
            return
        data = self.notion.request_json("GET", f"/databases/{database_id}")
        properties = data.get("properties", {})
        if isinstance(properties, dict) and "content_hash" not in properties:
            self.notion.request_json(
                "PATCH",
                f"/databases/{database_id}",
                {"properties": {"content_hash": {"rich_text": {}}}},
            )
        self.schema_checked = True

    def ensure_database(self) -> str:
        if self.database_id:
            return self.database_id

        cursor: str | None = None
        while True:
            query: dict[str, object] = {"page_size": 100}
            if cursor:
                query["start_cursor"] = cursor
            data = self.notion.request_json(
                "GET",
                f"/blocks/{self.parent_page_id}/children",
                query=query,
            )
            for item in data.get("results", []):
                if item.get("type") != "child_database":
                    continue
                child = item.get("child_database", {})
                title = child.get("title")
                if title != INDEX_DATABASE_TITLE:
                    continue
                database_id = item.get("id")
                if isinstance(database_id, str) and database_id:
                    self.database_id = database_id
                    self._ensure_schema(database_id)
                    return database_id
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")

        payload = {
            "parent": {"type": "page_id", "page_id": self.parent_page_id},
            "title": [{"type": "text", "text": {"content": INDEX_DATABASE_TITLE}}],
            "properties": {
                "Name": {"title": {}},
                "doc_sync_id": {"rich_text": {}},
                "doc_path": {"rich_text": {}},
                "notion_page_id": {"rich_text": {}},
                "content_hash": {"rich_text": {}},
                "status": {
                    "select": {
                        "options": [
                            {"name": STATUS_ACTIVE, "color": "green"},
                            {"name": STATUS_ARCHIVED, "color": "gray"},
                        ]
                    }
                },
                "last_synced_at": {"date": {}},
            },
        }
        created = self.notion.request_json("POST", "/databases", payload)
        database_id = created.get("id")
        if not isinstance(database_id, str) or not database_id:
            raise RuntimeError("Failed to create Notion docs index database")
        self.database_id = database_id
        self.schema_checked = True
        return database_id

    def _query(self, filter_payload: dict) -> list[DocIndexRecord]:
        database_id = self.ensure_database()
        records: list[DocIndexRecord] = []
        cursor: str | None = None
        while True:
            payload: dict[str, object] = {"filter": filter_payload, "page_size": 100}
            if cursor:
                payload["start_cursor"] = cursor
            data = self.notion.request_json(
                "POST",
                f"/databases/{database_id}/query",
                payload,
            )
            for item in data.get("results", []):
                record = _to_record(item)
                if record:
                    records.append(record)
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
        return records

    def preload(self) -> None:
        """Query all records from the database and populate both caches."""
        database_id = self.ensure_database()
        by_id: dict[str, DocIndexRecord] = {}
        by_path: dict[str, DocIndexRecord] = {}
        cursor: str | None = None
        while True:
            payload: dict[str, object] = {"page_size": 100}
            if cursor:
                payload["start_cursor"] = cursor
            data = self.notion.request_json(
                "POST",
                f"/databases/{database_id}/query",
                payload,
            )
            for item in data.get("results", []):
                record = _to_record(item)
                if record:
                    by_id[record.doc_sync_id] = record
                    if record.doc_path:
                        by_path[record.doc_path] = record
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
        with self._lock:
            self._cache = by_id
            self._path_cache = by_path

    def find_by_doc_sync_id(self, doc_sync_id: str) -> DocIndexRecord | None:
        if self._cache is not None:
            return self._cache.get(doc_sync_id)
        records = self._query(
            {
                "property": "doc_sync_id",
                "rich_text": {"equals": doc_sync_id},
            }
        )
        return records[0] if records else None

    def find_by_doc_path(self, doc_path: str) -> DocIndexRecord | None:
        if self._path_cache is not None:
            return self._path_cache.get(doc_path)
        records = self._query(
            {
                "property": "doc_path",
                "rich_text": {"equals": doc_path},
            }
        )
        return records[0] if records else None

    def upsert(
        self,
        *,
        doc_sync_id: str,
        doc_path: str,
        notion_page_id: str,
        status: str,
        title: str,
        content_hash: str | None = None,
        existing: DocIndexRecord | None = None,
    ) -> DocIndexRecord:
        database_id = self.ensure_database()
        current = existing if existing else self.find_by_doc_sync_id(doc_sync_id)
        resolved_hash = (
            content_hash if content_hash is not None else (current.content_hash if current else "")
        )

        properties = {
            "Name": _title_property(title),
            "doc_sync_id": _text_property(doc_sync_id),
            "doc_path": _text_property(doc_path),
            "notion_page_id": _text_property(notion_page_id),
            "content_hash": _text_property(resolved_hash),
            "status": {"select": {"name": status}},
            "last_synced_at": {
                "date": {"start": datetime.now(timezone.utc).replace(microsecond=0).isoformat()}
            },
        }

        if current:
            self.notion.request_json(
                "PATCH",
                f"/pages/{current.entry_page_id}",
                {"properties": properties},
            )
            record = DocIndexRecord(
                entry_page_id=current.entry_page_id,
                doc_sync_id=doc_sync_id,
                doc_path=doc_path,
                notion_page_id=notion_page_id,
                status=status,
                content_hash=resolved_hash,
            )
            self._update_caches(record)
            return record

        data = self.notion.request_json(
            "POST",
            "/pages",
            {
                "parent": {"database_id": database_id},
                "properties": properties,
            },
        )
        entry_page_id = data.get("id")
        if not isinstance(entry_page_id, str) or not entry_page_id:
            raise RuntimeError("Failed to create docs index entry")

        record = DocIndexRecord(
            entry_page_id=entry_page_id,
            doc_sync_id=doc_sync_id,
            doc_path=doc_path,
            notion_page_id=notion_page_id,
            status=status,
            content_hash=resolved_hash,
        )
        self._update_caches(record)
        return record

    def _update_caches(self, record: DocIndexRecord) -> None:
        with self._lock:
            if self._cache is not None:
                self._cache[record.doc_sync_id] = record
            if self._path_cache is not None and record.doc_path:
                self._path_cache[record.doc_path] = record
