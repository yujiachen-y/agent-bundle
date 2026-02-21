from pathlib import Path

skill_file = Path("/skills/SKILL.md")
output_file = Path("/workspace/result.txt")

skill_text = skill_file.read_text(encoding="utf-8")
lines = [line.strip() for line in skill_text.splitlines() if line.strip()]
summary = lines[0] if lines else "no-skill-content"

output_file.write_text(
    f"processed-by-python\nsource={summary}\n",
    encoding="utf-8",
)

print("wrote /workspace/result.txt")
