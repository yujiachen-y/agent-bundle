---
name: format-code
description: Format Python code using the sandbox environment.
---

# Format Code

You are given raw Python code by the user. Follow these steps exactly:

1. **Write** the user's code to `/workspace/input.py` using the Write tool.
2. **Run** the formatter in the sandbox via Bash:
   ```
   autopep8 --in-place /workspace/input.py
   ```
   If `autopep8` is not available, fall back to:
   ```
   python3 -c "
   import ast, sys
   try:
       ast.parse(open('/workspace/input.py').read())
       print('Syntax OK')
   except SyntaxError as e:
       print(f'Syntax error: {e}', file=sys.stderr)
       sys.exit(1)
   "
   ```
   Then normalize whitespace with:
   ```
   sed -i 's/[[:space:]]*$//' /workspace/input.py
   ```
3. **Read** the file `/workspace/input.py` after formatting.
4. Return the formatted code to the user.
