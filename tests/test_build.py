from __future__ import annotations

from pathlib import Path

import yaml

from agent_bundle.build import build_bundle
from agent_bundle.config import load_bundle_config


def test_build_dry_run_generates_dockerfile(tmp_path: Path) -> None:
    config_path = tmp_path / "bundle.yaml"
    config_payload = {
        "build": {
            "image": "demo:test",
            "context": ".",
            "dockerfile": "Dockerfile.agent-bundle",
        }
    }
    config_path.write_text(yaml.safe_dump(config_payload), encoding="utf-8")

    config, resolved = load_bundle_config(config_path)
    result = build_bundle(config, resolved, config_path=config_path, dry_run=True)

    assert result.dry_run is True
    assert result.image == "demo:test"
    assert "docker" in result.command[0]
    assert result.dockerfile_path.exists()
    dockerfile = result.dockerfile_path.read_text(encoding="utf-8")
    assert "CMD [\"agent-bundle\", \"serve\"" in dockerfile
