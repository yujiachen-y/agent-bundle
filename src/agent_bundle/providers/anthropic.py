from __future__ import annotations

import os

import httpx

from .base import BaseProvider, ProviderRequest, ProviderResponse


class AnthropicProvider(BaseProvider):
    def __init__(
        self,
        api_key: str | None,
        api_key_env: str | None,
        timeout_seconds: float,
        base_url: str | None = None,
    ) -> None:
        self._api_key = api_key or (os.getenv(api_key_env, "") if api_key_env else "")
        self._timeout = timeout_seconds
        self._base_url = (base_url or "https://api.anthropic.com").rstrip("/")

    async def complete(self, request: ProviderRequest) -> ProviderResponse:
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": request.model,
            "system": request.system_prompt,
            "messages": request.messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base_url}/v1/messages", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        parts = data.get("content", [])
        text = "\n".join(str(item.get("text", "")) for item in parts if isinstance(item, dict))
        return ProviderResponse(text=text, raw=data)
