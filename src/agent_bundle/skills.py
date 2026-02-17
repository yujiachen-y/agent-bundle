from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import yaml

from .config import ResolvedBundleConfig

LOGGER = logging.getLogger(__name__)
WORD_RE = re.compile(r"[a-zA-Z0-9_\-]{2,}")


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    source_path: str
    content: str
    keywords: frozenset[str]
    metadata: dict[str, Any] = field(default_factory=dict)


def _parse_frontmatter(markdown: str, source_path: Path) -> tuple[dict[str, Any], str]:
    lines = markdown.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError(
            f"{source_path} is missing YAML frontmatter; expected leading '---' block"
        )

    closing_index = -1
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            closing_index = index
            break

    if closing_index == -1:
        raise ValueError(f"{source_path} has unterminated YAML frontmatter")

    raw_frontmatter = "\n".join(lines[1:closing_index]).strip()
    parsed = yaml.safe_load(raw_frontmatter) if raw_frontmatter else {}
    if parsed is None:
        parsed = {}
    if not isinstance(parsed, dict):
        raise ValueError(f"{source_path} frontmatter must be a YAML object")

    body = "\n".join(lines[closing_index + 1 :]).lstrip("\n")
    return parsed, body


def _validate_skill_metadata(frontmatter: dict[str, Any], source_path: Path) -> tuple[str, str]:
    name = str(frontmatter.get("name", "")).strip()
    description = str(frontmatter.get("description", "")).strip()
    if not name:
        raise ValueError(f"{source_path} frontmatter must include non-empty 'name'")
    if not description:
        raise ValueError(f"{source_path} frontmatter must include non-empty 'description'")
    return name, description


def _extract_keywords(*chunks: str) -> frozenset[str]:
    terms: set[str] = set()
    for chunk in chunks:
        for token in WORD_RE.findall(chunk.lower()):
            terms.add(token)
    return frozenset(terms)


class SkillManager:
    def __init__(self, resolved: ResolvedBundleConfig, allow_network: bool = True) -> None:
        self._resolved = resolved
        self._allow_network = allow_network
        self._skills: list[Skill] = []

    @property
    def skills(self) -> list[Skill]:
        return list(self._skills)

    def discover(self) -> list[Skill]:
        loaded: list[Skill] = []
        for root in self._resolved.skill_paths:
            if not root.exists():
                LOGGER.info("skill path missing: %s", root)
                continue
            for file_path in sorted(root.rglob("SKILL.md")):
                loaded.append(self._load_local(file_path))
        loaded.extend(self._load_registries())

        limit = self._resolved.raw.skills.max_loaded
        self._skills = loaded[:limit]
        return self.skills

    def match(self, query: str, top_k: int = 3) -> list[Skill]:
        if not self._skills:
            return []
        query_terms = _extract_keywords(query)
        scored: list[tuple[int, Skill]] = []
        for skill in self._skills:
            overlap = len(query_terms.intersection(skill.keywords))
            if overlap > 0:
                scored.append((overlap, skill))
        scored.sort(key=lambda item: (-item[0], item[1].name.lower()))
        return [skill for _, skill in scored[:top_k]]

    def _load_local(self, file_path: Path) -> Skill:
        content = file_path.read_text(encoding="utf-8")
        frontmatter, body = _parse_frontmatter(content, file_path)
        name, description = _validate_skill_metadata(frontmatter, file_path)
        keywords = _extract_keywords(name, description, body[:1200])
        return Skill(
            name=name,
            description=description,
            source_path=str(file_path),
            content=body,
            keywords=keywords,
            metadata=frontmatter,
        )

    def _load_registries(self) -> list[Skill]:
        if not self._resolved.raw.skills.registries:
            return []
        if not self._allow_network:
            LOGGER.warning("registries configured but network is disabled")
            return []

        loaded: list[Skill] = []
        for registry_url in self._resolved.raw.skills.registries:
            try:
                loaded.extend(self._load_registry(registry_url))
            except Exception as exc:  # pragma: no cover - defensive
                LOGGER.warning("failed to load registry %s: %s", registry_url, exc)
        return loaded

    def _load_registry(self, registry_url: str) -> list[Skill]:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(registry_url)
            response.raise_for_status()
            payload = response.json()

        skills_payload = payload.get("skills", []) if isinstance(payload, dict) else []
        loaded: list[Skill] = []
        for item in skills_payload:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "remote-skill")).strip() or "remote-skill"
            description = str(item.get("description", "")).strip()
            content = str(item.get("content", "")).strip()
            source_path = f"{registry_url}::{name}"
            loaded.append(
                Skill(
                    name=name,
                    description=description,
                    source_path=source_path,
                    content=content,
                    keywords=_extract_keywords(name, description, content[:1200]),
                    metadata={},
                )
            )
        return loaded
