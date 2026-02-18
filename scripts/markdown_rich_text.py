"""Lightweight Markdown inline parser for Notion rich_text payloads."""

from __future__ import annotations

from dataclasses import dataclass

MAX_RICH_TEXT_CHUNK = 1800
MARKDOWN_ESCAPABLE_CHARS = set(r"\`*_{}[]()#+-.!|>")


@dataclass(frozen=True)
class InlineStyle:
    bold: bool = False
    italic: bool = False
    strikethrough: bool = False
    underline: bool = False
    code: bool = False

    def to_annotations(self) -> dict[str, bool | str]:
        return {
            "bold": self.bold,
            "italic": self.italic,
            "strikethrough": self.strikethrough,
            "underline": self.underline,
            "code": self.code,
            "color": "default",
        }


def _is_escaped(text: str, index: int) -> bool:
    backslashes = 0
    cursor = index - 1
    while cursor >= 0 and text[cursor] == "\\":
        backslashes += 1
        cursor -= 1
    return backslashes % 2 == 1


def _find_unescaped(text: str, marker: str, start: int) -> int:
    cursor = start
    while True:
        index = text.find(marker, cursor)
        if index < 0:
            return -1
        if not _is_escaped(text, index):
            return index
        cursor = index + 1


def _flush_buffer(
    buffer: list[str],
    style: InlineStyle,
    tokens: list[tuple[str, InlineStyle]],
) -> None:
    text = "".join(buffer)
    buffer.clear()
    _append_token(tokens, text, style)


def _append_token(tokens: list[tuple[str, InlineStyle]], text: str, style: InlineStyle) -> None:
    if not text:
        return
    if tokens and tokens[-1][1] == style:
        previous_text, _ = tokens[-1]
        tokens[-1] = (previous_text + text, style)
        return
    tokens.append((text, style))


def _opening_marker(text: str, index: int) -> str | None:
    for marker in ("**", "__", "~~"):
        if text.startswith(marker, index):
            return marker
    char = text[index]
    if char in {"*", "_"}:
        return char
    return None


def _style_for_marker(style: InlineStyle, marker: str) -> InlineStyle:
    if marker in {"**", "__"}:
        return InlineStyle(
            bold=True,
            italic=style.italic,
            strikethrough=style.strikethrough,
            underline=style.underline,
            code=style.code,
        )
    if marker in {"*", "_"}:
        return InlineStyle(
            bold=style.bold,
            italic=True,
            strikethrough=style.strikethrough,
            underline=style.underline,
            code=style.code,
        )
    return InlineStyle(
        bold=style.bold,
        italic=style.italic,
        strikethrough=True,
        underline=style.underline,
        code=style.code,
    )


def _parse_segment(text: str, style: InlineStyle, tokens: list[tuple[str, InlineStyle]]) -> None:
    cursor = 0
    buffer: list[str] = []

    while cursor < len(text):
        char = text[cursor]
        if char == "\\":
            if cursor + 1 < len(text) and text[cursor + 1] in MARKDOWN_ESCAPABLE_CHARS:
                buffer.append(text[cursor + 1])
                cursor += 2
                continue
            buffer.append(char)
            cursor += 1
            continue

        if char == "`":
            closing = _find_unescaped(text, "`", cursor + 1)
            if closing >= 0:
                _flush_buffer(buffer, style, tokens)
                code_text = text[cursor + 1 : closing]
                _append_token(tokens, code_text, InlineStyle(code=True))
                cursor = closing + 1
                continue

        marker = _opening_marker(text, cursor)
        if marker is not None:
            closing = _find_unescaped(text, marker, cursor + len(marker))
            if closing >= 0:
                inner = text[cursor + len(marker) : closing]
                if inner:
                    _flush_buffer(buffer, style, tokens)
                    _parse_segment(inner, _style_for_marker(style, marker), tokens)
                    cursor = closing + len(marker)
                    continue

        buffer.append(char)
        cursor += 1

    _flush_buffer(buffer, style, tokens)


def _chunk_tokens(tokens: list[tuple[str, InlineStyle]]) -> list[dict]:
    rich_text: list[dict] = []
    for raw_chunk, style in tokens:
        for index in range(0, len(raw_chunk), MAX_RICH_TEXT_CHUNK):
            chunk = raw_chunk[index : index + MAX_RICH_TEXT_CHUNK]
            if not chunk:
                continue
            item: dict = {"type": "text", "text": {"content": chunk}}
            if style != InlineStyle():
                item["annotations"] = style.to_annotations()
            rich_text.append(item)
    return rich_text


def to_rich_text(text: str, parse_markdown: bool = True) -> list[dict]:
    content = text.strip() if parse_markdown else text
    if not content:
        content = " "

    tokens: list[tuple[str, InlineStyle]] = []
    if parse_markdown:
        _parse_segment(content, InlineStyle(), tokens)
    else:
        _append_token(tokens, content, InlineStyle())

    rich_text = _chunk_tokens(tokens)
    return rich_text or [{"type": "text", "text": {"content": " "}}]
