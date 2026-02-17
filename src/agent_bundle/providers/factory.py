from __future__ import annotations

from .anthropic import AnthropicProvider
from .base import BaseProvider
from .dummy import DummyProvider
from .gemini import GeminiProvider
from .openai_compatible import OpenAICompatibleProvider
from ..config import ModelConfig


def create_provider(config: ModelConfig) -> BaseProvider:
    provider = config.provider.lower()

    if provider == "dummy":
        return DummyProvider()

    if provider in {"openai", "openai-compatible", "litellm", "openrouter", "codex-oauth"}:
        base_url = config.base_url or "https://api.openai.com/v1"
        if base_url.endswith("/v1"):
            base_url = base_url
        return OpenAICompatibleProvider(
            base_url=base_url,
            api_key=config.api_key,
            api_key_env=config.api_key_env,
            timeout_seconds=config.timeout_seconds,
            extra_headers=config.extra_headers,
        )

    if provider == "anthropic":
        return AnthropicProvider(
            api_key=config.api_key,
            api_key_env=config.api_key_env,
            timeout_seconds=config.timeout_seconds,
            base_url=config.base_url,
        )

    if provider == "gemini":
        return GeminiProvider(
            api_key=config.api_key,
            api_key_env=config.api_key_env,
            timeout_seconds=config.timeout_seconds,
            base_url=config.base_url,
        )

    raise ValueError(f"unsupported model provider: {config.provider}")
