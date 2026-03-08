# Agent: scan-calendars

## Task

Create `scripts/lib/scan-calendars.mjs` — a pure library that parses all weekly calendar HTML files and returns a sorted, deduplicated list of Period B lessons.

## What to create

A single new file: `scripts/lib/scan-calendars.mjs`

## Imports

```js
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CALENDAR_DIR } from "./paths.mjs";
```

`CALENDAR_DIR` is already exported from `scripts/lib/paths.mjs` — it resolves to the directory containing weekly calendar HTML files (e.g. `C:/Users/rober/Downloads/Projects/school/follow-alongs`).

## Export

```js
export function scanCalendars()
```

Returns: `Array<{ unit: number, lesson: number, date: Date, dateLabel: string, dayName: string, title: string }>`

Sorted by `date` ascending, deduplicated by `"unit.lesson"` key (keep earliest date).

## Calendar HTML structure

Calendar files match the pattern `*_calendar.html` or `*calendar*.html` in CALENDAR_DIR. Current files include names like `week_mar9_calendar.html`, `postbreak_calendar.html`, `week21_calendar.html`.

Each file contains a grid of day columns with this structure:

```html
<div class="day-column">
  <div class="day-header">
    <div class="day-name">Monday</div>
    <div class="day-date">Mar 9</div>
  </div>
  <div class="day-content">
    <div class="period-block period-b">
      <div class="period-label">📘 Period B</div>
      <div><span class="topic-tag">6.6</span></div>
      <div class="content-title">Concluding a Test for p</div>
      ...
    </div>
  </div>
</div>
```

There may also be other period blocks like `period-e` in the same day column. We only want Period B.

## Parsing algorithm

```
function scanCalendars():
  1. List all files in CALENDAR_DIR matching /_calendar\.html$/i  (use readdirSync + filter)
  2. For each file:
     a. Read as UTF-8
     b. Split on /<div\s+class="day-column">/ to get day sections
     c. For each day section:
        - Extract dayName: regex /<div\s+class="day-name">\s*(.*?)\s*<\/div>/
        - Extract dateLabel: regex /<div\s+class="day-date">\s*(.*?)\s*<\/div>/
        - Find Period B block: regex /<div\s+class="period-block[^"]*period-b[^"]*">([\s\S]*?)(?=<div\s+class="period-block|$)/
          (must match class containing "period-b")
        - If no Period B block, skip this day
        - Extract ALL topic tags: regex /<span\s+class="topic-tag[^"]*">\s*(.*?)\s*<\/span>/g
        - Extract content title: regex /<div\s+class="content-title">\s*(.*?)\s*<\/div>/
        - For each topic tag, parse with /(\d+)\.(\d+)/ to get unit and lesson
        - If regex doesn't match (e.g. "REVIEW"), skip
        - Resolve dateLabel to full Date: new Date(`${dateLabel}, 2026`)
        - Push { unit, lesson, date, dateLabel, dayName, title }
  3. Deduplicate by "unit.lesson" key — if same lesson appears multiple times, keep the one with the earliest date
  4. Sort by date ascending
  5. Return the array
```

## Edge cases to handle

1. **Multi-topic days**: A topic tag div may contain `"6.1, 6.2"` or there may be multiple `<span class="topic-tag">` elements. The regex with `/g` flag captures all. Parse each separately.

2. **Overlapping calendar files**: `postbreak_calendar.html` and `week_mar2_calendar.html` both cover Mar 2–6. The deduplication step handles this — earliest date wins.

3. **REVIEW days**: May 1 has topic "REVIEW" — the `/(\d+)\.(\d+)/` regex won't match, so it's silently skipped.

4. **Missing Period B**: Some day columns may have no period-b block (assembly/test days). Skip silently.

5. **HTML entities**: Content titles may have special characters. Don't worry about decoding HTML entities — just capture the raw text between tags.

6. **Empty CALENDAR_DIR**: If no calendar files found, return empty array.

## Expected output (for reference)

When run against current calendar files, should produce 36 entries from 5.4 through 9.5. First few:

```js
[
  { unit: 5, lesson: 4, date: Date("2026-02-09"), dateLabel: "Feb 9",  dayName: "Monday",   title: "Biased/Unbiased Point Estimates" },
  { unit: 5, lesson: 5, date: Date("2026-02-10"), dateLabel: "Feb 10", dayName: "Tuesday",  title: "Sampling Dist for p̂" },
  { unit: 5, lesson: 6, date: Date("2026-02-12"), dateLabel: "Feb 12", dayName: "Thursday", title: "Sampling Dist for p̂₁ − p̂₂" },
  ...
]
```

## Constraints

- Create ONLY `scripts/lib/scan-calendars.mjs`
- Do NOT modify any existing files
- Do NOT import anything not listed in the imports section
- Must be valid ESM (import/export, no require)
- Pure function — no side effects, no console output, no file writes
- Keep it under 80 lines
