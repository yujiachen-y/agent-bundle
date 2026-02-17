#!/usr/bin/env python3
"""Repository-level Python quality gates.

Checks:
- max file length
- max function length
- duplicate code windows
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATHS = ("scripts", "tests")
DEFAULT_MAX_FILE_LINES = 850
DEFAULT_MAX_FUNCTION_LINES = 90
DEFAULT_DUPLICATE_WINDOW = 6


@dataclass(frozen=True)
class Span:
    path: Path
    start: int
    end: int


def collect_python_files(paths: tuple[str, ...]) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    for raw in paths:
        path = Path(raw)
        if not path.exists():
            continue
        if path.is_file() and path.suffix == ".py":
            resolved = path.resolve()
            if resolved not in seen:
                seen.add(resolved)
                files.append(path)
            continue
        for candidate in path.rglob("*.py"):
            if "__pycache__" in candidate.parts:
                continue
            resolved = candidate.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            files.append(candidate)
    return sorted(files)


def check_file_length(files: list[Path], max_lines: int) -> list[str]:
    errors: list[str] = []
    for file in files:
        line_count = len(file.read_text(encoding="utf-8").splitlines())
        if line_count > max_lines:
            errors.append(f"{file}: file has {line_count} lines (max allowed: {max_lines})")
    return errors


def iter_functions(module: ast.AST) -> list[ast.FunctionDef | ast.AsyncFunctionDef]:
    funcs: list[ast.FunctionDef | ast.AsyncFunctionDef] = []
    for node in ast.walk(module):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            funcs.append(node)
    return funcs


def check_function_length(files: list[Path], max_lines: int) -> list[str]:
    errors: list[str] = []
    for file in files:
        source = file.read_text(encoding="utf-8")
        module = ast.parse(source)
        for func in iter_functions(module):
            end_lineno = getattr(func, "end_lineno", func.lineno)
            length = end_lineno - func.lineno + 1
            if length > max_lines:
                errors.append(
                    f"{file}:{func.lineno} function `{func.name}` has {length} lines "
                    f"(max allowed: {max_lines})"
                )
    return errors


def normalize_line(line: str) -> str:
    # Normalize surface differences to make duplicate detection more robust.
    no_comment = re.sub(r"\s+#.*$", "", line)
    no_strings = re.sub(r"(['\"]).*?\1", "STR", no_comment)
    no_numbers = re.sub(r"\b\d+\b", "NUM", no_strings)
    collapsed = re.sub(r"\s+", " ", no_numbers).strip()
    return collapsed


def sliding_windows(
    lines: list[tuple[int, str]],
    window: int,
) -> list[tuple[tuple[str, ...], int, int]]:
    if len(lines) < window:
        return []
    windows: list[tuple[tuple[str, ...], int, int]] = []
    for index in range(len(lines) - window + 1):
        chunk = lines[index : index + window]
        normalized = tuple(item[1] for item in chunk)
        start = chunk[0][0]
        end = chunk[-1][0]
        windows.append((normalized, start, end))
    return windows


def overlaps(a: Span, b: Span) -> bool:
    if a.path.resolve() != b.path.resolve():
        return False
    return not (a.end < b.start or b.end < a.start)


def check_duplicate_windows(files: list[Path], window: int) -> list[str]:
    errors: list[str] = []
    windows: dict[tuple[str, ...], list[Span]] = {}

    for file in files:
        raw_lines = file.read_text(encoding="utf-8").splitlines()
        normalized_lines: list[tuple[int, str]] = []
        for lineno, raw in enumerate(raw_lines, start=1):
            normalized = normalize_line(raw)
            if not normalized:
                continue
            normalized_lines.append((lineno, normalized))

        for sequence, start, end in sliding_windows(normalized_lines, window):
            windows.setdefault(sequence, []).append(Span(path=file, start=start, end=end))

    for sequence, spans in windows.items():
        if len(spans) < 2:
            continue
        first = spans[0]
        for candidate in spans[1:]:
            if first.path.resolve() == candidate.path.resolve():
                continue
            if overlaps(first, candidate):
                continue
            sample = " | ".join(sequence[:2])
            errors.append(
                f"Duplicate code ({window} normalized lines): "
                f"{first.path}:{first.start}-{first.end} and "
                f"{candidate.path}:{candidate.start}-{candidate.end} "
                f"sample={sample}"
            )
            break

    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Python quality gates")
    parser.add_argument("--max-file-lines", type=int, default=DEFAULT_MAX_FILE_LINES)
    parser.add_argument("--max-function-lines", type=int, default=DEFAULT_MAX_FUNCTION_LINES)
    parser.add_argument("--duplicate-window", type=int, default=DEFAULT_DUPLICATE_WINDOW)
    parser.add_argument(
        "--paths",
        nargs="+",
        default=list(DEFAULT_PATHS),
        help="Directories/files to scan for Python files",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    files = collect_python_files(tuple(args.paths))
    if not files:
        print("No Python files found for quality checks.")
        return 0

    errors: list[str] = []
    errors.extend(check_file_length(files, args.max_file_lines))
    errors.extend(check_function_length(files, args.max_function_lines))
    errors.extend(check_duplicate_windows(files, args.duplicate_window))

    if errors:
        for issue in errors:
            print(issue, file=sys.stderr)
        return 1

    print(
        "Python quality gates passed "
        f"(max_file_lines={args.max_file_lines}, "
        f"max_function_lines={args.max_function_lines}, "
        f"duplicate_window={args.duplicate_window})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
