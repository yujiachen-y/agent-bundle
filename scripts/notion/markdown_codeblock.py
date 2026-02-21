"""Code-fence language and content normalization for Notion code blocks."""

from __future__ import annotations

import re

NOTION_CODE_LANGUAGES = {
    "bash",
    "json",
    "markdown",
    "mermaid",
    "plain text",
    "python",
    "typescript",
    "yaml",
}
CODE_LANGUAGE_ALIASES = {
    "plaintext": "plain text",
    "text": "plain text",
    "ts": "typescript",
    "yml": "yaml",
}
MERMAID_MULTI_SOURCE_EDGE_RE = re.compile(
    r"^(\s*)([A-Za-z_][A-Za-z0-9_]*(?:\s*&\s*[A-Za-z_][A-Za-z0-9_]*)+)\s*-->\s*(.+)$"
)


def normalize_code_language(language_hint: str | None) -> str:
    if not language_hint:
        return "plain text"
    normalized = language_hint.strip().lower()
    mapped = CODE_LANGUAGE_ALIASES.get(normalized, normalized)
    if mapped in NOTION_CODE_LANGUAGES:
        return mapped
    return "plain text"


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
