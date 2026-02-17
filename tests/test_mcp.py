from __future__ import annotations

from fastapi.testclient import TestClient

from agent_bundle.server import create_app


def test_mcp_initialize_and_tool_call(runtime_fixture) -> None:
    runtime, _ = runtime_fixture
    client = TestClient(create_app(runtime))

    init_response = client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
    )
    assert init_response.status_code == 200
    assert init_response.json()["result"]["serverInfo"]["name"] == "agent-bundle-mcp"

    tools_response = client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    )
    tools = tools_response.json()["result"]["tools"]
    assert any(tool["name"] == "agent.run" for tool in tools)

    call_response = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "agent.run", "arguments": {"input": "plan the rollout"}},
        },
    )
    call_payload = call_response.json()
    assert "result" in call_payload
    assert call_payload["result"]["content"][0]["type"] == "text"
