# Agent Bundle

Agent Bundle packages a curated set of Agent Skills into a deployable runtime.

## Quickstart

```bash
pip install -e .
agent-bundle serve
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) for the lightweight chat UI.

## Commands

- `agent-bundle serve --config <bundle.yaml>`: start local runtime.
- `agent-bundle build --config <bundle.yaml>`: generate Dockerfile and build image.
- `agent-bundle validate --config <bundle.yaml>`: validate bundle config.

## Bundle Config (YAML)

Default config is `bundle.yaml` at repo root. A secondary config for the examples folder is `examples/bundle.yaml`.
