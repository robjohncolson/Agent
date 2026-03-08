# Spec: "Prep next undeveloped" menu option

## Overview

New menu item in `scripts/menu.mjs` that scans all calendar HTML files, diffs against the lesson registry, and presents undeveloped lessons sorted by calendar date for the user to pick and prep.

## Motivation

"Prep for tomorrow" only handles the next calendar day. A teacher batch-prepping multiple days ahead needs to see which lessons are missing or incomplete across the full remaining schedule, pick one, and launch the pipeline.

## User flow

```
Main Menu
> Prep next undeveloped    ← NEW
  Prep for tomorrow (auto-detect)
  Prep specific lesson
  ...
```

### Step-by-step

1. **Scan calendars** — Parse every `*_calendar.html` in CALENDAR_DIR. Extract all Period B lessons: date, day name, topic tag (e.g. `6.6`), content title.

2. **Deduplicate** — If the same unit.lesson appears on multiple dates (e.g. `5.7` on Feb 13 and Feb 26), keep the earliest occurrence only.

3. **Diff against registry** — For each calendar lesson, check `getLesson(unit, lesson)`:
   - **Missing**: No registry entry at all → mark as `"not started"`
   - **Incomplete**: Entry exists but at least one of the critical steps (`worksheet`, `blooketCsv`, `blooketUpload`, `schoology`) is not `"done"` / `"skipped"` / `"scraped"` → mark as `"incomplete (N/7)"`
   - **Done**: All 7 status keys are `"done"` / `"skipped"` / `"scraped"` → skip (don't show)

4. **Display list** — Show undeveloped lessons sorted by calendar date:
   ```
   Undeveloped Lessons (Period B)
   ──────────────────────────────
   ○ Mar  9  6.6  — Concluding a Test for p           [not started]
   ◐ Mar 10  6.7  — Potential Errors (Type I & II)     [3/7 done]
   ○ Mar 12  6.8  — CI for Difference of Two Prop...   [not started]
   ...
   ── Back
   ```
   Symbols: `○` = not started, `◐` = incomplete, dimmed `Back` at bottom.

5. **User selects** → Show current status detail (if entry exists), then skip toggles (pre-selected from registry), then auto-launch:
   ```
   node scripts/lesson-prep.mjs --unit 6 --lesson 8 --skip-X ...
   ```
   Same flow as "Prep specific lesson" from the skip-toggle step onward.

6. **After pipeline finishes** → Return to main menu (not the undeveloped list).

## Calendar parsing

### Source files

Located in `CALENDAR_DIR` (from `paths.mjs`). Current files:

| File | Dates covered |
|------|---------------|
| `week21_calendar.html` | Feb 9–13 |
| `postbreak_calendar.html` | Feb 23–27, Mar 2–6 |
| `week_mar2_calendar.html` | Mar 2–6 |
| `week_mar9_calendar.html` | Mar 9–13 |
| `week_mar16_calendar.html` | Mar 16–20 |
| `week_mar23_calendar.html` | Mar 23–27 |
| `week_mar30_calendar.html` | Mar 30–Apr 3 |
| `week_apr6_calendar.html` | Apr 6–10 |
| `week_apr13_calendar.html` | Apr 13–17 |
| `week_apr27_calendar.html` | Apr 27–May 1 |

### HTML structure

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

### Parsing algorithm

```
for each *_calendar.html in CALENDAR_DIR:
  read file as UTF-8
  split on /<div\s+class="day-column">/
  for each day section:
    extract dayName from .day-name
    extract dateLabel from .day-date  (e.g. "Mar 9")
    find Period B block (class contains "period-b" or label contains "Period B")
    extract topic tag(s) from <span class="topic-tag">
    extract content title from .content-title
    parse topic tag with /(\d+)\.(\d+)/ → unit, lesson
    resolve dateLabel to full Date (infer year = 2026)
```

### Date resolution

Calendar dates are like `"Mar 9"` with no year. Since calendars span Feb–May, infer year = 2026. Use month to disambiguate: months Jan–May = 2026. Parse via:

```js
new Date(`${dateLabel}, 2026`)   // "Mar 9, 2026" → valid Date
```

### Deduplication

Some lessons span multiple days or appear in overlapping calendar files (e.g. `week_mar2_calendar.html` and `postbreak_calendar.html` both cover Mar 2–6). Deduplicate by `unit.lesson` key, keeping the entry with the earliest calendar date.

### Edge cases

- **Multi-topic days**: `"6.1, 6.2"` appears on Mar 2. Parse as two separate entries (6.1 and 6.2), both dated Mar 2.
- **REVIEW days**: May 1 is "REVIEW" with no numeric topic tag. Skip these (regex won't match).
- **Missing Period B**: Some days may not have Period B (e.g. assembly days). Skip silently.

## Registry diffing

### "Critical steps" for completeness check

All 7 status keys are evaluated:

```js
const STATUS_KEYS = [
  "ingest", "worksheet", "drills",
  "blooketCsv", "blooketUpload",
  "animations", "schoology"
];
```

A step counts as "resolved" if its value is `"done"`, `"skipped"`, or `"scraped"`.

### Categories

| Category | Condition | Display |
|----------|-----------|---------|
| Not started | `getLesson(u, l)` returns `null` | `○ [not started]` |
| Incomplete | Entry exists, resolved < 7 | `◐ [N/7 done]` |
| Done | All 7 resolved | Hidden from list |

## New code location

All new code goes in `scripts/menu.mjs`. No new files. Specifically:

### New helper: `scanCalendars()`

```js
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CALENDAR_DIR } from "./lib/paths.mjs";  // add to existing import
```

Returns: `Array<{ unit, lesson, date: Date, dateLabel, dayName, title }>` sorted by date, deduplicated by `unit.lesson`.

### New menu function: `prepNextUndeveloped()`

1. Call `scanCalendars()`
2. For each entry, check registry
3. Filter to not-started + incomplete
4. If none found: print "All calendar lessons are fully prepped!" and return
5. Build prompts choices array
6. Show select prompt
7. On selection: show status (if exists) → skip toggles → run `lesson-prep.mjs --unit U --lesson L --skip-X ...`

### Menu integration

Add to main menu choices array at position 0 (before "Prep for tomorrow"):

```js
{ title: "Prep next undeveloped", value: "next" },
```

Add to switch statement:

```js
case "next": await prepNextUndeveloped(); break;
```

## Imports added

```js
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
```

And add `CALENDAR_DIR` to the existing `paths.mjs` import line.

## Not in scope

- Live Schoology scraping (registry is consulted as-is; user can run scrape from Utility Tools first)
- Period E or other periods
- Modifying any existing scripts
- Creating new files beyond editing `scripts/menu.mjs`

## Full Period B lesson timeline (reference)

Extracted from current calendar files. This is what `scanCalendars()` should produce:

| Date | Unit.Lesson | Title |
|------|-------------|-------|
| Feb 9 | 5.4 | Biased/Unbiased Point Estimates |
| Feb 10 | 5.5 | Sampling Dist for p̂ |
| Feb 12 | 5.6 | Sampling Dist for p̂₁ − p̂₂ |
| Feb 13 | 5.7 | Sampling Dist for x̄ |
| Feb 27 | 5.8 | Sampling Dist for x̄₁ − x̄₂ |
| Mar 2 | 6.1 | Why Be Normal? |
| Mar 2 | 6.2 | Constructing CI for p |
| Mar 3 | 6.3 | Justifying Claims Based on CI |
| Mar 5 | 6.4 | Setting Up a Test for p |
| Mar 6 | 6.5 | Interpreting p-Values |
| Mar 9 | 6.6 | Concluding a Test for p |
| Mar 10 | 6.7 | Potential Errors (Type I & II) |
| Mar 12 | 6.8 | CI for Difference of Two Proportions |
| Mar 13 | 6.9 | Justifying Claims (Diff of Proportions) |
| Mar 16 | 6.10 | Setting Up Test for p₁ − p₂ |
| Mar 17 | 6.11 | Carrying Out Test for p₁ − p₂ |
| Mar 19 | 7.1 | Intro to Inference for Means |
| Mar 20 | 7.2 | Constructing CI for μ |
| Mar 23 | 7.3 | Justifying Claims About μ Based on CI |
| Mar 24 | 7.4 | Setting Up a Test for μ |
| Mar 26 | 7.5 | Carrying Out a Test for μ |
| Mar 27 | 7.6 | CI for Difference of Two Means |
| Mar 30 | 7.7 | Justifying Claims (Diff of Means) |
| Mar 31 | 7.8 | Setting Up Test for μ₁ − μ₂ |
| Apr 2 | 7.9 | Carrying Out Test for μ₁ − μ₂ |
| Apr 6 | 8.1 | Intro: Are My Results Unexpected? |
| Apr 7 | 8.2 | Setting Up Chi-Square GOF Test |
| Apr 9 | 8.3 | Carrying Out Chi-Square GOF Test |
| Apr 10 | 8.4 | Expected Counts in Two-Way Tables |
| Apr 13 | 8.5 | Setting Up Chi-Square Test (Homog/Indep) |
| Apr 14 | 8.6 | Carrying Out Chi-Square Test |
| Apr 16 | 9.1 | Intro: Do Those Points Align? |
| Apr 17 | 9.2 | CI for Slope of Regression Model |
| Apr 27 | 9.3 | Justifying Claims About Slope (CI) |
| Apr 28 | 9.4 | Setting Up Test for Slope |
| Apr 30 | 9.5 | Carrying Out Test for Slope |

36 total lessons (5.4 through 9.5). The REVIEW day (May 1) is excluded.

## Verification

1. `npm start` → main menu shows "Prep next undeveloped" as first option
2. Select it → list shows all lessons not in registry (currently 35 of 36, since only 6.10 is done)
3. Select any lesson → skip toggles appear → selecting none runs `lesson-prep.mjs --unit U --lesson L`
4. Ctrl+C at any prompt → clean exit
5. After prepping a lesson and re-entering, that lesson disappears from the list (or moves to incomplete with N/7)
