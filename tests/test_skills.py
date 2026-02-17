from __future__ import annotations

from pathlib import Path

import yaml

from agent_bundle.config import load_bundle_config
from agent_bundle.skills import SkillManager


def test_skill_discovery_and_matching(tmp_path: Path) -> None:
    alpha = tmp_path / "skills" / "alpha"
    alpha.mkdir(parents=True)
    (alpha / "SKILL.md").write_text(
        "# Alpha Planning\n\nBest for milestone planning and risk breakdown.\n",
        encoding="utf-8",
    )

    beta = tmp_path / "skills" / "beta"
    beta.mkdir(parents=True)
    (beta / "SKILL.md").write_text(
        "# Beta Coding\n\nBest for bug fixes and refactors.\n",
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
    assert matches[0].name == "Alpha Planning"
