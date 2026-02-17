from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from agent_bundle.config import load_bundle_config
from agent_bundle.skills import SkillManager


def test_skill_discovery_and_matching(tmp_path: Path) -> None:
    alpha = tmp_path / "skills" / "alpha"
    alpha.mkdir(parents=True)
    (alpha / "SKILL.md").write_text(
        "---\n"
        "name: alpha-planning\n"
        "description: Best for milestone planning and risk breakdown.\n"
        "---\n\n"
        "# Alpha Skill\n\n"
        "Use for milestone planning and risk breakdown.\n",
        encoding="utf-8",
    )

    beta = tmp_path / "skills" / "beta"
    beta.mkdir(parents=True)
    (beta / "SKILL.md").write_text(
        "---\n"
        "name: beta-coding\n"
        "description: Best for bug fixes and refactors.\n"
        "---\n\n"
        "# Beta Skill\n\n"
        "Use for bug fixes and refactors.\n",
        encoding="utf-8",
    )

    config_path = tmp_path / "bundle.yaml"
    config_path.write_text(
        yaml.safe_dump(
            {
                "skills": {"paths": ["./skills"], "registries": [], "max_loaded": 50},
                "permissions": {"allow_network": True},
            }
        ),
        encoding="utf-8",
    )

    config, resolved = load_bundle_config(config_path)
    manager = SkillManager(resolved, allow_network=config.permissions.allow_network)
    skills = manager.discover()

    assert len(skills) == 2
    matches = manager.match("please help with milestone planning")
    assert matches
    assert matches[0].name == "alpha-planning"


def test_skill_discovery_requires_frontmatter(tmp_path: Path) -> None:
    invalid = tmp_path / "skills" / "invalid"
    invalid.mkdir(parents=True)
    (invalid / "SKILL.md").write_text(
        "# Missing Frontmatter\n\nThis should be rejected.\n",
        encoding="utf-8",
    )

    config_path = tmp_path / "bundle.yaml"
    config_path.write_text(
        yaml.safe_dump(
            {
                "skills": {"paths": ["./skills"], "registries": [], "max_loaded": 50},
                "permissions": {"allow_network": True},
            }
        ),
        encoding="utf-8",
    )

    config, resolved = load_bundle_config(config_path)
    manager = SkillManager(resolved, allow_network=config.permissions.allow_network)

    with pytest.raises(ValueError, match="missing YAML frontmatter"):
        manager.discover()
