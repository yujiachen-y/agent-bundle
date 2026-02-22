---
name: format-code
description: Format Python code using the sandbox environment.
---

# Format Code

You are given raw Python code by the user. Follow these steps exactly:

1. **Write** the user's code to `/workspace/input.py` using the Write tool.
2. **Run** the formatter in the sandbox using Bash:
   ```
   autopep8 --in-place /workspace/input.py
   ```
3. **Read** `/workspace/input.py` using the Read tool.
4. Return the Read result as the final answer.

Rules:

- Always use the path `/workspace/input.py`.
- Do not invent formatted output from memory.
- Do not skip the Read step.
- If the Bash command fails, return the command error output directly.
