---
name: data-analysis
description: Analyze data using Python with pandas, matplotlib, and numpy.
---

# Data Analysis

You are given a data analysis task by the user. Follow these steps:

1. **Write** a Python script to `/workspace/analysis.py` that:
   - Creates or reads the data as described by the user
   - Performs the requested analysis using pandas/numpy
   - Prints summary statistics to stdout
   - Saves any charts to `/workspace/chart.png` using matplotlib (use `savefig`, not `show`)

2. **Run** the script in the sandbox using Bash:
   ```
   cd /workspace && python3 analysis.py
   ```

3. **Read** the Bash output to get the printed results.

4. Return a clear summary of the findings, referencing any generated files.

Rules:

- Always use `/workspace/` as the working directory.
- Use `matplotlib.use('Agg')` before importing pyplot (no display server).
- Save figures with `plt.savefig('/workspace/chart.png', dpi=100, bbox_inches='tight')`.
- If the user provides CSV data inline, write it to `/workspace/data.csv` first.
- If the Bash command fails, return the error output and suggest fixes.
