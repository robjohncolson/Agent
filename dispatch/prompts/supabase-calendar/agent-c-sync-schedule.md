# Agent C: sync-schedule-to-supabase.mjs (Migration Script)

## Overview
Create `scripts/sync-schedule-to-supabase.mjs` — a one-time migration script that reads the local topic schedule and lesson registry, merges them, and upserts all rows to the Supabase `topic_schedule` table.

## Target File
`scripts/sync-schedule-to-supabase.mjs` — **NEW**

## Dependency
- Requires `scripts/lib/supabase-schedule.mjs` (Agent A) — imports `bulkSync` and `upsertTopic`

## Data Sources

### 1. `config/topic-schedule.json`
Period-aware format:
```json
{
  "B": { "6.1": "2026-03-02", "6.2": "2026-03-02", ... },
  "E": { "6.1": "2026-03-06", "6.2": "2026-03-06", ... }
}
```

### 2. `state/lesson-registry.json`
Entries have optional `date` and `topic` fields:
```json
{
  "6.10": {
    "unit": 6, "lesson": 10,
    "topic": "Monday 3/16/26",
    "date": "2026-03-16",
    "status": { ... },
    "schoology": {
      "B": { "folderId": "986721319", ... },
      "E": { "folderId": "986896988", ... }
    }
  }
}
```

## Behavior

1. Read both files using `readFileSync` with paths from `./lib/paths.mjs` (`AGENT_ROOT`)
2. For each period ("B" then "E"):
   a. Start with `topic-schedule.json[period]` as the base (topic → date)
   b. Enrich with real data:
      - `title`: look up from units.js (see Title Generation section below) — **not** a placeholder
      - `status`: if `registry[key].status.schoology === "done"` → `"posted"`, else `"scheduled"`
      - `schoologyFolderId`: from `registry[key].schoology[period].folderId` if present
   c. Upsert each entry via `upsertTopic(topic, period, { date, title, status, schoologyFolderId })`
3. Print summary: `"Synced X rows for Period B, Y rows for Period E (Z errors)"`

## CLI Interface

```bash
node scripts/sync-schedule-to-supabase.mjs           # dry-run (prints what would be upserted)
node scripts/sync-schedule-to-supabase.mjs --execute  # actually upserts to Supabase
```

### Dry-run output format
```
[dry-run] Period B: 31 topics to sync
  7.3  2026-03-23  scheduled  (no folder ID)
  7.4  2026-03-24  posted     folder=986313435
  ...
[dry-run] Period E: 31 topics to sync
  ...
Total: 62 rows. Run with --execute to upsert.
```

## Imports

```javascript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT, UNITS_JS_PATH } from './lib/paths.mjs';
import { upsertTopic } from './lib/supabase-schedule.mjs';
```

## Title Generation — REQUIRED from units.js

The calendar page renders the `title` field as the subtitle on every topic card. Placeholder titles like "Topic 7.3" are **not acceptable** — students see this page.

Read canonical topic descriptions from `curriculum_render/data/units.js`:
- Path: use `UNITS_JS_PATH` from `./lib/paths.mjs` (resolves to `C:/Users/ColsonR/curriculum_render/data/units.js`)
- **File format**: plain JS file (no exports), starts with `const ALL_UNITS_DATA = [`. It is NOT a CommonJS or ESM module — there is no `export` or `module.exports`.
- Structure: array of unit objects, each with `topics[]` containing `{ id: "7-3", name: "Topic 7.3", description: "Justifying a Claim About a Population Mean Based on a Confidence Interval" }`
- **Parse strategy**: read the file as text, use `new Function()` to evaluate and return the array:
  ```javascript
  const src = readFileSync(UNITS_JS_PATH, 'utf-8');
  // The file defines `const ALL_UNITS_DATA = [...]` with no export.
  // Wrap in a function that returns the value.
  const fn = new Function(src + '\nreturn ALL_UNITS_DATA;');
  const allUnits = fn();
  ```
- Build a `Map<string, string>` of topic key → description:
  - Iterate `allUnits[i].topics[j]`
  - Map `id` format `"7-3"` → topic key `"7.3"` (replace `-` with `.`)
  - Value = the `description` field
- Use the `description` as the `title` value in the upsert

Fallback: if `units.js` cannot be read or a specific topic is not found in it, use `"Topic {key}"` — but log a warning per missing title so the user knows titles are incomplete.

Example titles from units.js:
- `7.3` → `"Justifying a Claim About a Population Mean Based on a Confidence Interval"`
- `7.8` → `"Setting Up a Test for the Difference of Two Population Means"`
- `8.1` → (similar pattern for units 8 and 9)

## Do NOT
- Do not modify any existing files
- Do not delete or replace `config/topic-schedule.json` — it remains as offline fallback
- Do not import `@supabase/supabase-js`
