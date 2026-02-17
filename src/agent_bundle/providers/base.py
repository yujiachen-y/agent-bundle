from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class ProviderRequest:
    model: str
    messages: list[dict[str, str]]
    temperature: float
    max_tokens: int
    system_prompt: str


@dataclass
class ProviderResponse:
    text: str
    raw: dict[str, Any]


class BaseProvider(ABC):
    @abstractmethod
    async def complete(self, request: ProviderRequest) -> ProviderResponse:
        raise NotImplementedError
