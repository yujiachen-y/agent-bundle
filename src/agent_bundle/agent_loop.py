from __future__ import annotations

from dataclasses import dataclass

from .config import ModelConfig
from .providers.base import BaseProvider, ProviderRequest
from .skills import Skill, SkillManager


@dataclass
class AgentResult:
    text: str
    selected_skills: list[Skill]
    provider_raw: dict


class AgentLoop:
    def __init__(self, skill_manager: SkillManager, provider: BaseProvider, model_config: ModelConfig) -> None:
        self._skills = skill_manager
        self._provider = provider
        self._model = model_config

    async def run(self, messages: list[dict[str, str]]) -> AgentResult:
        user_query = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                user_query = msg.get("content", "")
                break

        selected = self._skills.match(user_query)
        system_prompt = self._build_system_prompt(selected)

        request = ProviderRequest(
            model=self._model.model,
            messages=messages,
            temperature=self._model.temperature,
            max_tokens=self._model.max_tokens,
            system_prompt=system_prompt,
        )
        response = await self._provider.complete(request)

        return AgentResult(
            text=response.text,
            selected_skills=selected,
            provider_raw=response.raw,
        )

    @staticmethod
    def _build_system_prompt(skills: list[Skill]) -> str:
        if not skills:
            return "You are a concise agent runtime. Return clear and actionable answers."

        sections = [
            "You are an agent runtime executing a curated skill bundle.",
            "Use the following skills as constraints and context:",
        ]
        for skill in skills:
            snippet = skill.content[:1200]
            sections.append(f"## {skill.name}\nsource: {skill.source_path}\n{snippet}")
        sections.append("Return concise and practical outputs.")
        return "\n\n".join(sections)
