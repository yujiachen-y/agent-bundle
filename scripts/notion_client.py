"""Thin Notion API client used by docs sync."""

from __future__ import annotations

import json
import time
from typing import Optional
from urllib import error, parse, request


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
        body = json.dumps(payload).encode("utf-8") if payload is not None else None

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
                                "content": (title.strip() or "Untitled")[:2000],
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
                                "content": (title.strip() or "Untitled")[:2000],
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
            ids.extend(item["id"] for item in data.get("results", []) if not item.get("archived"))
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")
        return ids

    def replace_page_content(self, page_id: str, blocks: list[dict]) -> None:
        child_ids = self.list_child_ids(page_id)
        for child_id in child_ids:
            self.request_json("PATCH", f"/blocks/{child_id}", {"archived": True})

        for i in range(0, len(blocks), 100):
            self.request_json(
                "PATCH",
                f"/blocks/{page_id}/children",
                {"children": blocks[i : i + 100]},
            )
