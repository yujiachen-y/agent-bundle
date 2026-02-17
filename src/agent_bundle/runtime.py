from __future__ import annotations

from dataclasses import dataclass

from .agent_loop import AgentLoop, AgentResult
from .config import BundleConfig, ResolvedBundleConfig
from .providers.factory import create_provider
from .sandbox import SandboxService
from .skills import SkillManager


@dataclass
class RuntimeResponse:
    text: str
    selected_skills: list[str]
    provider_meta: dict


class AgentRuntime:
    def __init__(self, config: BundleConfig, resolved: ResolvedBundleConfig) -> None:
        self.config = config
        self.resolved = resolved

        self.skill_manager = SkillManager(resolved, allow_network=config.permissions.allow_network)
        self.skill_manager.discover()

        self.sandbox = SandboxService(
            workspace_root=resolved.workspace_root,
            allow_shell=config.permissions.allow_shell,
        )

        self.provider = create_provider(config.model)
        self.loop = AgentLoop(self.skill_manager, self.provider, config.model)

    async def chat(self, messages: list[dict[str, str]]) -> RuntimeResponse:
        result: AgentResult = await self.loop.run(messages)
        return RuntimeResponse(
            text=result.text,
            selected_skills=[skill.name for skill in result.selected_skills],
            provider_meta=result.provider_raw,
        )
