from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .mcp import MCPServer
from .runtime import AgentRuntime
from .ui import chat_page_html


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionsRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage]
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, alias="max_tokens")


class JSONRPCRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: Any | None = None
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


def create_app(runtime: AgentRuntime) -> FastAPI:
    app = FastAPI(title="Agent Bundle Runtime", version="0.1.0")
    mcp_server = MCPServer(runtime)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "bundle": runtime.config.bundle.name,
            "skillsLoaded": len(runtime.skill_manager.skills),
        }

    @app.get("/", response_class=HTMLResponse)
    async def root() -> HTMLResponse:
        if not runtime.config.service.chat_ui:
            raise HTTPException(status_code=404, detail="chat UI disabled")
        return HTMLResponse(chat_page_html(runtime.config.model.model))

    @app.post("/v1/chat/completions")
    async def chat_completions(body: ChatCompletionsRequest) -> dict[str, Any]:
        if not body.messages:
            raise HTTPException(status_code=400, detail="messages cannot be empty")

        result = await runtime.chat([item.model_dump() for item in body.messages])
        content = result.text

        completion_id = f"chatcmpl-{uuid.uuid4().hex[:18]}"
        created = int(time.time())

        prompt_tokens = _rough_token_count("\n".join(msg.content for msg in body.messages))
        completion_tokens = _rough_token_count(content)

        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": body.model or runtime.config.model.model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": content,
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
            "agent_bundle": {
                "selected_skills": result.selected_skills,
            },
        }

    @app.post("/mcp")
    async def mcp_endpoint(body: JSONRPCRequest) -> dict[str, Any]:
        return await mcp_server.handle(body.model_dump(by_alias=True))

    return app


def _rough_token_count(text: str) -> int:
    if not text:
        return 0
    return max(1, int(len(text.split()) * 1.3))
