from __future__ import annotations

from fastapi.testclient import TestClient

from agent_bundle.server import create_app


def test_chat_completions_endpoint(runtime_fixture) -> None:
    runtime, _ = runtime_fixture
    client = TestClient(create_app(runtime))

    response = client.post(
        "/v1/chat/completions",
        json={
            "model": "dummy-v1",
            "messages": [{"role": "user", "content": "Need planning advice with tradeoff details"}],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["object"] == "chat.completion"
    assert payload["choices"][0]["message"]["role"] == "assistant"
    assert "dummy-provider" in payload["choices"][0]["message"]["content"]
    assert "planner-skill" in payload["agent_bundle"]["selected_skills"]
