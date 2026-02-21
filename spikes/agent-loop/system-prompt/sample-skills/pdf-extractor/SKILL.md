---
name: pdf-extractor
description: Extract text, tables, and form fields from PDF files. Use for PDF parsing, indexing, and conversion to structured JSON.
license: MIT
compatibility: Python 3.10+, pypdf, pdfplumber
metadata:
  owner: platform-data
---

# PDF Extractor

## Setup

Run once:

```bash
python3 -m pip install --quiet pypdf pdfplumber
```

## Usage

Extract page text:

```bash
python3 scripts/extract_text.py input.pdf > output.json
```

Extract tables:

```bash
python3 scripts/extract_tables.py input.pdf > tables.json
```

## Notes

- Prefer extraction to JSON arrays with stable field names.
- Keep page numbers in output for traceability.
- If OCR is needed, return a clear fallback recommendation.
