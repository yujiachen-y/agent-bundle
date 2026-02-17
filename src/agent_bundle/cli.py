from __future__ import annotations

import threading
from enum import Enum
from pathlib import Path

import typer
import uvicorn

from .build import build_bundle
from .config import load_bundle_config
from .runtime import AgentRuntime
from .server import create_app
from .tui import run_terminal_chat

app = typer.Typer(help="Bundle skills into a deployable agent runtime")


class ServeMode(str, Enum):
    api = "api"
    tui = "tui"
    both = "both"


@app.command()
def validate(config: Path = typer.Option(Path("bundle.yaml"), exists=True, help="Path to bundle YAML")) -> None:
    loaded, resolved = load_bundle_config(config)
    typer.echo(f"bundle: {loaded.bundle.name}@{loaded.bundle.version}")
    typer.echo(f"skills paths: {', '.join(str(p) for p in resolved.skill_paths)}")
    typer.echo(f"workspace root: {resolved.workspace_root}")


@app.command()
def serve(
    config: Path = typer.Option(Path("bundle.yaml"), exists=True, help="Path to bundle YAML"),
    host: str | None = typer.Option(None, help="Host override"),
    port: int | None = typer.Option(None, help="Port override"),
    mode: ServeMode = typer.Option(ServeMode.api, help="serve mode"),
) -> None:
    loaded, resolved = load_bundle_config(config)
    runtime = AgentRuntime(loaded, resolved)

    listen_host = host or loaded.service.host
    listen_port = port or loaded.service.port

    if mode == ServeMode.tui:
        run_terminal_chat(runtime)
        return

    web_app = create_app(runtime)

    if mode == ServeMode.api:
        uvicorn.run(web_app, host=listen_host, port=listen_port)
        return

    server = uvicorn.Server(uvicorn.Config(web_app, host=listen_host, port=listen_port, log_level="info"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        run_terminal_chat(runtime)
    finally:
        server.should_exit = True
        thread.join(timeout=5)


@app.command()
def build(
    config: Path = typer.Option(Path("bundle.yaml"), exists=True, help="Path to bundle YAML"),
    image: str | None = typer.Option(None, help="Image tag override"),
    dry_run: bool = typer.Option(False, help="Only generate Dockerfile and show command"),
) -> None:
    loaded, resolved = load_bundle_config(config)
    result = build_bundle(
        config=loaded,
        resolved=resolved,
        config_path=config.resolve(),
        dry_run=dry_run,
        image_tag=image,
    )

    typer.echo(f"dockerfile: {result.dockerfile_path}")
    typer.echo(f"image: {result.image}")
    typer.echo(f"command: {' '.join(result.command)}")

    if dry_run:
        typer.echo("dry-run enabled; docker build not executed")
        return

    if result.stdout.strip():
        typer.echo(result.stdout)
    if result.stderr.strip():
        typer.echo(result.stderr, err=True)
    if result.return_code != 0:
        raise typer.Exit(code=result.return_code)


if __name__ == "__main__":
    app()
