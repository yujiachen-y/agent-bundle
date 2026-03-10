# PDF to Deck Demo

Standalone demo that turns a PDF into a polished PPTX using skills.sh skills: `pdf`, `pptx`, and `theme-factory`.

## Prerequisites

- Node.js 20+
- `E2B_API_KEY`
- `OPENROUTER_API_KEY`

## Quick Start

```bash
cd demo/pdf-to-deck
npm install
E2B_API_KEY=... OPENROUTER_API_KEY=... npm run setup
```

The setup script validates E2B access, builds the E2B template, and starts `npx agent-bundle dev`.

## Smoke Test

Encode the sample PDF and ask the agent to reconstruct it as `/workspace/input.pdf`, then generate slides:

```bash
cd demo/pdf-to-deck
PDF_B64="$(base64 < ./sample/sample.pdf | tr -d '\n')"
curl -s http://localhost:3000/v1/responses \
  -H 'Content-Type: application/json' \
  -d "{
    \"input\": [
      {
        \"role\": \"user\",
        \"content\": \"Take this base64 PDF data and decode it to /workspace/input.pdf:\\n${PDF_B64}\\nThen create a polished 5-slide presentation from /workspace/input.pdf and save it as /workspace/output.pptx. Include concise speaker notes and summarize the generated files.\"
      }
    ]
  }"
```

## Notes

- Skills are sourced directly from skills.sh via `github: anthropics/skills`.
- Sample input lives at `sample/sample.pdf`.
