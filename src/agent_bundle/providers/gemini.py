from __future__ import annotations

import os

import httpx

from .base import BaseProvider, ProviderRequest, ProviderResponse


class GeminiProvider(BaseProvider):
    def __init__(
        self,
        api_key: str | None,
        api_key_env: str | None,
        timeout_seconds: float,
        base_url: str | None = None,
    ) -> None:
        self._api_key = api_key or (os.getenv(api_key_env, "") if api_key_env else "")
        self._timeout = timeout_seconds
        self._base_url = (
            base_url or "https://generativelanguage.googleapis.com/v1beta/models"
        ).rstrip("/")

    async def complete(self, request: ProviderRequest) -> ProviderResponse:
        if not self._api_key:
            raise ValueError("Gemini provider requires api_key or api_key_env")

        url = f"{self._base_url}/{request.model}:generateContent?key={self._api_key}"
        payload = {
            "contents": [
                {
                    "role": msg.get("role", "user"),
                    "parts": [{"text": msg.get("content", "")}],
                }
                for msg in request.messages
            ],
            "systemInstruction": {"parts": [{"text": request.system_prompt}]},
            "generationConfig": {
                "temperature": request.temperature,
                "maxOutputTokens": request.max_tokens,
            },
        }

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        candidates = data.get("candidates", [])
        text = ""
        if candidates:
            content = candidates[0].get("content", {})
            parts = content.get("parts", [])
            text = "\n".join(str(part.get("text", "")) for part in parts if isinstance(part, dict))
        return ProviderResponse(text=text, raw=data)
