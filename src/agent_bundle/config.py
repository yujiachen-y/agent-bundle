from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator


class BundleMetadata(BaseModel):
    name: str = "agent-bundle"
    version: str = "0.1.0"
    description: str = ""


class SkillsConfig(BaseModel):
    paths: list[str] = Field(default_factory=lambda: ["./skills"])
    registries: list[str] = Field(default_factory=list)
    max_loaded: int = 200


class ModelConfig(BaseModel):
    provider: str = "dummy"
    model: str = "dummy-v1"
    base_url: str | None = None
    api_key: str | None = None
    api_key_env: str | None = None
    temperature: float = 0.2
    max_tokens: int = 512
    timeout_seconds: float = 60.0
    extra_headers: dict[str, str] = Field(default_factory=dict)

    @field_validator("temperature")
    @classmethod
    def validate_temperature(cls, value: float) -> float:
        if not 0 <= value <= 2:
            raise ValueError("temperature must be between 0 and 2")
        return value


class PermissionsConfig(BaseModel):
    workspace_root: str = "."
    allow_shell: bool = False
    allow_network: bool = True


class ServiceConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8787
    chat_ui: bool = True
    tui: bool = False


class BuildConfig(BaseModel):
    image: str = "agent-bundle:latest"
    context: str = "."
    dockerfile: str = "Dockerfile.agent-bundle"


class BundleConfig(BaseModel):
    bundle: BundleMetadata = Field(default_factory=BundleMetadata)
    skills: SkillsConfig = Field(default_factory=SkillsConfig)
    model: ModelConfig = Field(default_factory=ModelConfig)
    permissions: PermissionsConfig = Field(default_factory=PermissionsConfig)
    service: ServiceConfig = Field(default_factory=ServiceConfig)
    build: BuildConfig = Field(default_factory=BuildConfig)

    def resolve(self, base_dir: Path) -> "ResolvedBundleConfig":
        return ResolvedBundleConfig(
            raw=self,
            base_dir=base_dir.resolve(),
            skill_paths=[(base_dir / p).resolve() for p in self.skills.paths],
            workspace_root=(base_dir / self.permissions.workspace_root).resolve(),
            build_context=(base_dir / self.build.context).resolve(),
            dockerfile_path=(base_dir / self.build.dockerfile).resolve(),
        )


class ResolvedBundleConfig(BaseModel):
    raw: BundleConfig
    base_dir: Path
    skill_paths: list[Path]
    workspace_root: Path
    build_context: Path
    dockerfile_path: Path

    model_config = {"arbitrary_types_allowed": True}


def load_bundle_config(path: str | Path) -> tuple[BundleConfig, ResolvedBundleConfig]:
    config_path = Path(path).resolve()
    payload: dict[str, Any]
    with config_path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}
    config = BundleConfig.model_validate(payload)
    resolved = config.resolve(config_path.parent)
    return config, resolved
