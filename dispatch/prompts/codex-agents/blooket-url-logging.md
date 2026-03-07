# Agent: Blooket URL Logging

Add upload history logging to `scripts/upload-blooket.mjs` so Blooket set URLs are persisted locally.

## Context

When `upload-blooket.mjs` creates a Blooket set, it prints the URL and copies it to the clipboard — but never saves it anywhere. When the user loses a link, there's no local record to check before scraping the dashboard.

## Hard Constraints

- Modify ONLY: `scripts/upload-blooket.mjs`
- Create ONLY: `state/blooket-uploads.json` (on first write)
- Do NOT modify any other scripts or lib files.
- Do NOT change existing functionality — this is purely additive.

## Deliverables

### 1. After a successful upload, append an entry to `state/blooket-uploads.json`

The file is a JSON array. Each entry:

```json
{
  "unit": 6,
  "lesson": 5,
  "title": "AP Stats 6.5 Review",
  "url": "https://dashboard.blooket.com/set/69aa45856790eef16f71aebb",
  "csvPath": "C:/Users/ColsonR/apstats-live-worksheet/u6_l5_blooket.csv",
  "createdAt": "2026-03-06T14:30:00Z"
}
```

### 2. Implementation details

- Read the existing file with `JSON.parse(readFileSync(...))`, or start with `[]` if the file doesn't exist.
- Push the new entry.
- Write the file back with `JSON.stringify(arr, null, 2)`.
- Use `import { readFileSync, writeFileSync, existsSync } from "node:fs"` (some already imported).
- Place the logging logic right after the URL is extracted and clipboard-copied — look for where `clipboardy` or `execSync('clip')` is called.
- Log to console: `Saved upload record to state/blooket-uploads.json`
- Use `new Date().toISOString()` for `createdAt`.
- Path to log file: `join(import.meta.dirname, "../state/blooket-uploads.json")` or resolve relative to the repo root.

### 3. Seed the file

Create `state/blooket-uploads.json` with an empty array `[]` so it exists in the repo.
