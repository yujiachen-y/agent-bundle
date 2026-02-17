from __future__ import annotations

import asyncio

from .runtime import AgentRuntime


def run_terminal_chat(runtime: AgentRuntime) -> None:
    print("Agent Bundle terminal mode. Type 'exit' to quit.")
    messages: list[dict[str, str]] = []

    while True:
        try:
            user_input = input("you> ").strip()
        except EOFError:
            print()
            break

        if not user_input:
            continue
        if user_input.lower() in {"exit", "quit"}:
            break

        messages.append({"role": "user", "content": user_input})
        output = asyncio.run(runtime.chat(messages))
        messages.append({"role": "assistant", "content": output.text})

        print(f"agent> {output.text}")
        if output.selected_skills:
            print(f"skills> {', '.join(output.selected_skills)}")
