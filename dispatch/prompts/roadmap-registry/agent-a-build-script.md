# Agent A: Build Roadmap Data Script

## Task
Create `scripts/build-roadmap-data.mjs` — a Node.js build script that reads the lesson registry
and topic schedule, then produces `roadmap-data.json` for the AP Stats roadmap calendar.

## Owned File
- `scripts/build-roadmap-data.mjs` (CREATE)

## Input Files (read-only)
- `state/lesson-registry.json` — lesson data keyed by topic (e.g., `"6.1"`, `"7.3"`)
- `config/topic-schedule.json` — `{ "B": { "6.1": "2026-03-02", ... }, "E": { ... } }`

## Output Files (write)
- `C:/Users/ColsonR/apstats-live-worksheet/roadmap-data.json`
- Also modifies `C:/Users/ColsonR/apstats-live-worksheet/ap_stats_roadmap.html` (BAKED_REGISTRY injection only)

## Behavior

### 1. Read inputs
```javascript
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
```

Read `state/lesson-registry.json` and `config/topic-schedule.json` relative to the script's
directory (`../state/` and `../config/`).

### 2. Compute registry version
SHA-256 hash of the registry JSON file contents, first 12 hex chars.

### 3. Build lessons object
For each key in registry (e.g., `"6.1"`):
```json
{
  "topic": registry[key].topic,
  "urls": {
    "worksheet": registry[key].urls.worksheet || null,
    "drills": registry[key].urls.drills || null,
    "quiz": registry[key].urls.quiz || null,
    "blooket": registry[key].urls.blooket || null
  },
  "status": "<computed>",
  "periods": {
    "B": {
      "date": topicSchedule.B[key] || null,
      "schoologyFolder": registry[key].urls.schoologyFolder || null,
      "posted": <has B schoology materials>,
      "verified": <B verified>
    },
    "E": {
      "date": topicSchedule.E[key] || null,
      "schoologyFolder": registry[key].urls.schoologyFolderE || null,
      "posted": <has E schoology materials>,
      "verified": <E verified>
    }
  }
}
```

### 4. Status derivation
Count how many of the 4 URLs (worksheet, drills, quiz, blooket) are non-null.
Check if at least one period has `posted === true`.

| Condition | Status |
|-----------|--------|
| All 4 URLs present AND at least one period posted | `"ready"` |
| Some URLs present OR some periods posted | `"partial"` |
| No URLs at all | `"pending"` |

### 5. Posted/verified logic
For period B: `registry[key].schoology?.B?.materials` — if this object exists and has at least
one key (worksheet/drills/quiz/blooket), `posted = true`.
For verified: `registry[key].schoology?.B?.verifiedAt != null`.
Same for period E.

### 6. Write roadmap-data.json
```json
{
  "generatedAt": "<ISO timestamp>",
  "registryVersion": "<12-char sha256>",
  "lessons": { ... }
}
```
Write to `C:/Users/ColsonR/apstats-live-worksheet/roadmap-data.json`.
Log: `Wrote roadmap-data.json (N lessons)`.

### 7. Inject BAKED_REGISTRY into HTML
Read `C:/Users/ColsonR/apstats-live-worksheet/ap_stats_roadmap.html`.
Find the line matching `const BAKED_REGISTRY = ` and replace that entire line with:
```javascript
const BAKED_REGISTRY = <JSON of the output>;
```
Write back the HTML file. Log: `Injected BAKED_REGISTRY into ap_stats_roadmap.html`.

If the pattern is not found, log a warning but don't fail.

## Acceptance Criteria
- Script runs with `node scripts/build-roadmap-data.mjs` from the Agent repo root
- Produces valid JSON at the output path
- Status derivation matches the spec rules
- BAKED_REGISTRY injection works (regex replaces the placeholder line)
- Handles missing registry keys gracefully (skip lessons with no data)
- Uses ESM imports (`.mjs` extension)
