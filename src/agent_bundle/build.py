from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .config import BundleConfig, ResolvedBundleConfig


@dataclass
class BuildResult:
    image: str
    dockerfile_path: Path
    command: list[str]
    return_code: int
    stdout: str
    stderr: str
    dry_run: bool


def render_dockerfile(config_in_container: str) -> str:
    return f"""FROM python:3.12-slim
WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir .
EXPOSE 8080
CMD [\"agent-bundle\", \"serve\", \"--config\", \"{config_in_container}\", \"--host\", \"0.0.0.0\", \"--port\", \"8080\"]
"""


def build_bundle(
    config: BundleConfig,
    resolved: ResolvedBundleConfig,
    config_path: Path,
    dry_run: bool = False,
    image_tag: str | None = None,
) -> BuildResult:
    image = image_tag or config.build.image

    try:
        config_in_container = str(config_path.resolve().relative_to(resolved.build_context))
    except ValueError:
        config_in_container = config_path.name

    dockerfile_contents = render_dockerfile(config_in_container)
    dockerfile_path = resolved.dockerfile_path
    dockerfile_path.write_text(dockerfile_contents, encoding="utf-8")

    command = [
        "docker",
        "build",
        "-f",
        str(dockerfile_path),
        "-t",
        image,
        str(resolved.build_context),
    ]

    if dry_run:
        return BuildResult(
            image=image,
            dockerfile_path=dockerfile_path,
            command=command,
            return_code=0,
            stdout=json.dumps({"command": command}, ensure_ascii=False),
            stderr="",
            dry_run=True,
        )

    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )

    return BuildResult(
        image=image,
        dockerfile_path=dockerfile_path,
        command=command,
        return_code=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
        dry_run=False,
    )
