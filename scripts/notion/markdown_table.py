"""Markdown table parser for Notion block conversion."""

from __future__ import annotations

import re
from typing import Callable

TABLE_SEPARATOR_CELL_RE = re.compile(r"^:?-{3,}:?$")
UNESCAPED_PIPE_RE = re.compile(r"(?<!\\)\|")
ATX_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def split_table_cells(line: str) -> list[str]:
    stripped = line.strip()
    if "|" not in stripped:
        return []
    core = stripped
    if core.startswith("|"):
        core = core[1:]
    if core.endswith("|"):
        core = core[:-1]
    if not core and stripped.startswith("|") and stripped.endswith("|"):
        return []
    cells = [part.replace(r"\|", "|").strip() for part in UNESCAPED_PIPE_RE.split(core)]
    if len(cells) < 2:
        return []
    return cells


def is_table_separator(cells: list[str]) -> bool:
    return bool(cells) and all(TABLE_SEPARATOR_CELL_RE.fullmatch(cell) for cell in cells)


def normalize_row_width(cells: list[str], width: int) -> list[str]:
    if len(cells) < width:
        return cells + [""] * (width - len(cells))
    return cells[:width]


def parse_heading_line(stripped: str) -> tuple[str, str] | None:
    if stripped.startswith("#### "):
        return "heading_3", stripped[5:].strip()
    if stripped.startswith("### "):
        return "heading_3", stripped[4:].strip()
    if stripped.startswith("## "):
        return "heading_2", stripped[3:].strip()
    if stripped.startswith("# "):
        return "heading_1", stripped[2:].strip()
    return None


def normalize_heading_for_notion(
    stripped_line: str,
    skipped_first_h1: bool,
) -> tuple[str | None, bool]:
    match = ATX_HEADING_RE.match(stripped_line)
    if not match:
        return stripped_line, skipped_first_h1
    level = len(match.group(1))
    text = match.group(2).strip()
    if not text:
        return stripped_line, skipped_first_h1
    if level == 1 and not skipped_first_h1:
        return None, True
    notion_level = min(level - 1, 3) if level >= 2 else 1
    return f"{'#' * notion_level} {text}", skipped_first_h1


def make_table_block(rows: list[list[str]], to_rich_text: Callable[[str], list[dict]]) -> dict:
    width = len(rows[0])
    children = [
        {
            "object": "block",
            "type": "table_row",
            "table_row": {
                "cells": [to_rich_text(cell) for cell in row],
            },
        }
        for row in rows
    ]
    return {
        "object": "block",
        "type": "table",
        "table": {
            "table_width": width,
            "has_column_header": True,
            "has_row_header": False,
            "children": children,
        },
    }


def parse_markdown_table(
    lines: list[str],
    start_index: int,
    to_rich_text: Callable[[str], list[dict]],
) -> tuple[dict | None, int]:
    if start_index + 1 >= len(lines):
        return None, start_index

    header_cells = split_table_cells(lines[start_index])
    separator_cells = split_table_cells(lines[start_index + 1])
    if not header_cells or len(separator_cells) != len(header_cells):
        return None, start_index
    if not is_table_separator(separator_cells):
        return None, start_index

    rows: list[list[str]] = [header_cells]
    cursor = start_index + 2
    while cursor < len(lines):
        current = lines[cursor].strip()
        if not current:
            break
        cells = split_table_cells(lines[cursor])
        if not cells:
            break
        rows.append(normalize_row_width(cells, len(header_cells)))
        cursor += 1

    return make_table_block(rows, to_rich_text), cursor
