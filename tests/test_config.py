from __future__ import annotations

from pathlib import Path

import yaml

from agent_bundle.config import load_bundle_config


def test_load_bundle_config_resolves_paths(tmp_path: Path) -> None:
    config_path = tmp_path / "bundle.yaml"
    payload = {
        "bundle": {"name": "demo", "version": "0.1.0"},
        "skills": {"paths": ["./skills"]},
        "permissions": {"workspace_root": "."},
        "build": {"context": ".", "dockerfile": "Dockerfile.agent-bundle"},
    }
    config_path.write_text(yaml.safe_dump(payload), encoding="utf-8")

    config, resolved = load_bundle_config(config_path)

    assert config.bundle.name == "demo"
    assert resolved.base_dir == tmp_path.resolve()
    assert resolved.skill_paths[0] == (tmp_path / "skills").resolve()
    assert resolved.workspace_root == tmp_path.resolve()
