# Agent: csv-validation

## Goal

Implement Blooket CSV validation and auto-fix. Two files to touch:

1. **CREATE** `scripts/lib/validate-blooket-csv.mjs` — validation + auto-fix module
2. **MODIFY** `scripts/lib/build-codex-prompts.mjs` — add "no commas in answers" to Blooket prompt

## File 1: scripts/lib/validate-blooket-csv.mjs

Create this module with two named exports:

### `validateBlooketCsv(csvPath)`

Validates a Blooket CSV file. Returns `{ valid: boolean, errors: string[] }`.

Checks (in order):
1. File exists and is non-empty
2. No UTF-8 BOM (byte order mark `\uFEFF`)
3. Row 1 starts with `"Blooket` (the Blooket import template header)
4. Row 2 is the header row with `Question #,Question Text,Answer 1,...`
5. For each data row (row 3+):
   - Exactly 26 comma-separated fields (use proper CSV parsing that respects quoted fields with embedded newlines)
   - Question # is a sequential integer starting from 1
   - Question Text (field 2) is non-empty
   - Answer 1-4 (fields 3-6) are non-empty
   - Time limit (field 7) is a number between 10 and 300
   - Correct answer (field 8) is a number 1-4
   - **CRITICAL**: No commas inside any answer text field (fields 3-6) — Blooket breaks on these even when quoted
   - No non-ASCII characters (check fields 1-8 only)
   - Fields 9-26 should be empty
6. No trailing blank lines
7. Between 15 and 40 question rows (configurable via optional `options.minQuestions` / `options.maxQuestions`)

### `autoFixBlooketCsv(csvPath)`

Attempts to auto-fix common issues. Returns `{ fixed: boolean, changes: string[] }`.

Fixes to apply:
1. Strip UTF-8 BOM if present
2. Strip trailing blank lines
3. Replace commas inside answer text fields (fields 3-6) with semicolons
4. Replace non-ASCII characters in answer fields with ASCII equivalents:
   - `≠` → `!=`, `→` → `->`, `≤` → `<=`, `≥` → `>=`, `π` → `pi`, `μ` → `mu`, `σ` → `sigma`, `p̂` → `p-hat`
5. Write the fixed file back to the same path

### CSV Parsing

Use a simple but correct CSV parser (don't use external deps — the project has no CSV library). Handle:
- Fields enclosed in double quotes
- Doubled quotes inside quoted fields (`""` = literal `"`)
- Embedded newlines inside quoted fields (the Blooket header row 1 has `\n` inside quotes)

### Module shape

```js
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function validateBlooketCsv(csvPath, options = {}) {
  // ...
  return { valid, errors };
}

export function autoFixBlooketCsv(csvPath) {
  // ...
  return { fixed, changes };
}
```

No default export. No external dependencies. Use ES module syntax (`import`/`export`).

## File 2: scripts/lib/build-codex-prompts.mjs

Find the `buildBlooketPrompt` function (around line 240). In the "Key format rules" section, after the line about trailing commas, add this constraint:

```
- CRITICAL: NEVER use commas inside answer text. If an answer naturally contains a comma, rephrase it or use a semicolon instead. Commas inside answer fields break Blooket's CSV parser even when the field is quoted. Example: instead of "mean, median, and mode" write "mean; median; and mode".
- CRITICAL: Use only ASCII characters in all fields. No Unicode symbols (≠, →, ≤, ≥, π, μ, σ). Use text equivalents instead: != for ≠, -> for →, <= for ≤, >= for ≥, pi for π, mu for μ, sigma for σ, p-hat for p̂.
```

Insert these two lines right after the existing "Key format rules" bullet list (after the line about `18 trailing commas`), before the `## Video context` section.

## Constraints

- No external dependencies (no npm packages)
- ES module syntax throughout
- No TypeScript
- Keep the CSV parser minimal but correct
