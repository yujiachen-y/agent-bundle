from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any


class SandboxService:
    def __init__(self, workspace_root: Path, allow_shell: bool) -> None:
        self.workspace_root = workspace_root.resolve()
        self.allow_shell = allow_shell

    def assert_in_workspace(self, path: Path) -> Path:
        resolved = path.resolve()
        try:
            resolved.relative_to(self.workspace_root)
        except ValueError as exc:
            raise PermissionError(
                f"path {resolved} is outside workspace root {self.workspace_root}"
            ) from exc
        return resolved

    def run_shell(self, command: str, cwd: str | None = None, timeout: float = 30) -> dict[str, Any]:
        if not self.allow_shell:
            raise PermissionError("shell execution is disabled by bundle permissions")

        run_cwd = self.workspace_root
        if cwd is not None:
            run_cwd = self.assert_in_workspace((self.workspace_root / cwd).resolve())

        completed = subprocess.run(
            command,
            shell=True,
            cwd=run_cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        return {
            "exit_code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "cwd": str(run_cwd),
        }
