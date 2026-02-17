from __future__ import annotations

from .base import BaseProvider, ProviderRequest, ProviderResponse


class DummyProvider(BaseProvider):
    async def complete(self, request: ProviderRequest) -> ProviderResponse:
        last_user = ""
        for message in reversed(request.messages):
            if message.get("role") == "user":
                last_user = message.get("content", "")
                break

        response = (
            "[dummy-provider]\n"
            f"model={request.model}\n"
            f"temperature={request.temperature}\n"
            f"answer: {last_user}"
        )
        return ProviderResponse(text=response, raw={"provider": "dummy"})
