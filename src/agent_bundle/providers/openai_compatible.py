from __future__ import annotations

import os

import httpx

from .base import BaseProvider, ProviderRequest, ProviderResponse


class OpenAICompatibleProvider(BaseProvider):
    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        api_key_env: str | None,
        timeout_seconds: float,
        extra_headers: dict[str, str],
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key or (os.getenv(api_key_env, "") if api_key_env else "")
        self._timeout = timeout_seconds
        self._extra_headers = extra_headers

    async def complete(self, request: ProviderRequest) -> ProviderResponse:
        headers = {"Content-Type": "application/json", **self._extra_headers}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        payload = {
            "model": request.model,
            "messages": [{"role": "system", "content": request.system_prompt}, *request.messages],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base_url}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        text = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        return ProviderResponse(text=text, raw=data)
