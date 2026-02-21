---
name: data-validator
description: Validate CSV or JSON datasets against schema and quality rules. Use for ingestion checks, drift checks, and release gates.
license: Apache-2.0
compatibility: Python 3.10+, pandas
metadata:
  owner: analytics-core
---

# Data Validator

## Goal

Catch invalid records before they are promoted to downstream systems.

## Inputs

- A dataset path (CSV or JSON)
- A schema path (JSON schema)
- Optional quality rule file

## Setup

```bash
python3 -m pip install --quiet pandas jsonschema
```

## Workflow

1. Parse schema and required fields.
2. Validate row-level field types and required constraints.
3. Apply quality rules:
   - Duplicate primary key detection
   - Null-rate threshold check
   - Value domain constraints
4. Emit summary report with:
   - total rows
   - failed rows
   - grouped failure reasons
5. Write failed rows to a separate artifact for triage.

## Commands

```bash
python3 scripts/validate.py \
  --input ./dataset.csv \
  --schema ./schema.json \
  --rules ./rules.yaml \
  --report ./report.json \
  --failed ./failed.csv
```

## Output Contract

The report JSON must include:

```json
{
  "status": "pass|fail",
  "totalRows": 0,
  "failedRows": 0,
  "checks": [
    {"name": "required_fields", "status": "pass|fail", "details": "..."}
  ]
}
```

## Failure Handling

- If schema parsing fails, stop immediately and return an actionable error.
- If dataset is too large, process in chunks and merge summaries.
- If the dataset format is ambiguous, detect and explain assumptions explicitly.
