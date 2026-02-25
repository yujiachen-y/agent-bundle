#!/usr/bin/env bash
set -euo pipefail

MAX_FILES="${1:-15}"
SEARCH_ROOT="${2:-src}"

exit_code=0

while IFS= read -r dir; do
  count=$(find "$dir" -maxdepth 1 -type f \( -name '*.ts' -o -name '*.mts' \) | wc -l | tr -d ' ')
  if [ "$count" -gt "$MAX_FILES" ]; then
    echo "FAIL: $dir has $count .ts/.mts files (limit: $MAX_FILES)" >&2
    exit_code=1
  fi
done < <(find "$SEARCH_ROOT" -type d)

if [ "$exit_code" -eq 0 ]; then
  echo "OK: no directory under $SEARCH_ROOT exceeds $MAX_FILES .ts/.mts files"
fi

exit "$exit_code"
