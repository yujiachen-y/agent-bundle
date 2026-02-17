from __future__ import annotations

import json
from typing import Any

from .runtime import AgentRuntime


class MCPServer:
    def __init__(self, runtime: AgentRuntime) -> None:
        self._runtime = runtime

    async def handle(self, payload: dict[str, Any]) -> dict[str, Any]:
        request_id = payload.get("id")
        method = payload.get("method")
        params = payload.get("params", {})

        try:
            if method == "initialize":
                result = {
                    "protocolVersion": "2025-11-05",
                    "serverInfo": {
                        "name": "agent-bundle-mcp",
                        "version": "0.1.0",
                    },
                    "capabilities": {"tools": {}},
                }
            elif method == "tools/list":
                result = {"tools": self._list_tools()}
            elif method == "tools/call":
                result = await self._call_tool(params)
            else:
                return self._error(request_id, -32601, f"method not found: {method}")

            return {"jsonrpc": "2.0", "id": request_id, "result": result}
        except Exception as exc:
            return self._error(request_id, -32000, str(exc))

    def _list_tools(self) -> list[dict[str, Any]]:
        tools = [
            {
                "name": "agent.run",
                "description": "Run the bundle agent loop on user input.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"input": {"type": "string"}},
                    "required": ["input"],
                },
            }
        ]

        if self._runtime.config.permissions.allow_shell:
            tools.append(
                {
                    "name": "sandbox.exec",
                    "description": "Execute shell command in workspace sandbox.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "command": {"type": "string"},
                            "cwd": {"type": "string"},
                        },
                        "required": ["command"],
                    },
                }
            )
        return tools

    async def _call_tool(self, params: dict[str, Any]) -> dict[str, Any]:
        tool_name = params.get("name")
        arguments = params.get("arguments", {})

        if tool_name == "agent.run":
            user_input = str(arguments.get("input", "")).strip()
            output = await self._runtime.chat([{"role": "user", "content": user_input}])
            return {
                "content": [
                    {
                        "type": "text",
                        "text": output.text,
                    }
                ],
                "meta": {
                    "selectedSkills": output.selected_skills,
                    "provider": output.provider_meta,
                },
            }

        if tool_name == "sandbox.exec":
            command = str(arguments.get("command", "")).strip()
            cwd = arguments.get("cwd")
            result = self._runtime.sandbox.run_shell(command, cwd=cwd)
            return {
                "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
                "meta": {"exitCode": result.get("exit_code")},
            }

        raise ValueError(f"unsupported tool: {tool_name}")

    @staticmethod
    def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": message},
        }
