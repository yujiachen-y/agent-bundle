from __future__ import annotations

from pathlib import Path

import pytest

from agent_bundle.sandbox import SandboxService


def test_sandbox_blocks_shell_when_disabled(tmp_path: Path) -> None:
    sandbox = SandboxService(workspace_root=tmp_path, allow_shell=False)

    with pytest.raises(PermissionError):
        sandbox.run_shell("echo blocked")


def test_sandbox_executes_when_enabled(tmp_path: Path) -> None:
    sandbox = SandboxService(workspace_root=tmp_path, allow_shell=True)
    result = sandbox.run_shell("echo hello")

    assert result["exit_code"] == 0
    assert "hello" in result["stdout"]
