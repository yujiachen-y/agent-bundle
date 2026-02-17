from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from agent_bundle.config import load_bundle_config
from agent_bundle.runtime import AgentRuntime


@pytest.fixture
def runtime_fixture(tmp_path: Path) -> tuple[AgentRuntime, Path]:
    skills_dir = tmp_path / "skills" / "planner"
    skills_dir.mkdir(parents=True)
    (skills_dir / "SKILL.md").write_text(
        "---\n"
        "name: planner-skill\n"
        "description: Handle planning, tradeoff analysis, and delivery sequencing.\n"
        "---\n\n"
        "# Planner Skill Instructions\n\n"
        "Use this skill for milestone planning and rollout sequencing.\n",
        encoding="utf-8",
    )

    config_path = tmp_path / "bundle.yaml"
    config_payload = {
        "bundle": {"name": "test-bundle", "version": "0.1.0"},
        "skills": {"paths": ["./skills"], "registries": [], "max_loaded": 20},
        "model": {"provider": "dummy", "model": "dummy-v1", "temperature": 0.1, "max_tokens": 200},
        "permissions": {"workspace_root": ".", "allow_shell": False, "allow_network": True},
        "service": {"host": "127.0.0.1", "port": 9000, "chat_ui": True, "tui": False},
        "build": {"image": "test-image:latest", "context": ".", "dockerfile": "Dockerfile.agent-bundle"},
    }
    config_path.write_text(yaml.safe_dump(config_payload), encoding="utf-8")

    config, resolved = load_bundle_config(config_path)
    runtime = AgentRuntime(config, resolved)
    return runtime, config_path
