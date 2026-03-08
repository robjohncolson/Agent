# Agent: registry-links

## Task

Add two new exported functions to `scripts/lib/lesson-registry.mjs`:
- `updateSchoologyLink(unit, lesson, linkKey, statusObj)` — upsert a per-link status entry under a new `schoologyLinks` field
- `getSchoologyLinks(unit, lesson)` — return the `schoologyLinks` object for a lesson (or `null`)

These complement the existing `schoology` status field (which tracks the overall step). The new `schoologyLinks` field tracks **each individual link** posted to Schoology (worksheet, drills, quiz, blooket, video1, video2, etc.).

## File to modify

`scripts/lib/lesson-registry.mjs` (311 lines)

## Architecture context

The registry uses `upsertLesson()` + `deepMerge()` internally. Each lesson entry looks like:
```json
{
  "unit": 6, "lesson": 5,
  "topic": "...",
  "urls": { "worksheet": "...", "drills": "...", "quiz": "...", "blooket": "...", "schoologyFolder": "..." },
  "status": { "ingest": "done", "worksheet": "done", ..., "schoology": "done" },
  "timestamps": { "created": "...", "lastUpdated": "..." }
}
```

The new `schoologyLinks` field sits at the same level as `urls` and `status`:
```json
{
  "schoologyLinks": {
    "worksheet": { "status": "done", "postedAt": "2026-03-08T...", "title": "Topic 6.5 — Follow-Along Worksheet" },
    "drills":    { "status": "done", "postedAt": "2026-03-08T...", "title": "Topic 6.5 — Drills" },
    "quiz":      { "status": "failed", "error": "timeout", "attemptedAt": "2026-03-08T..." },
    "blooket":   { "status": "done", "postedAt": "2026-03-08T...", "title": "Topic 6.5 — Blooket Review" },
    "video1":    { "status": "done", "postedAt": "2026-03-08T...", "title": "Topic 6.5 — AP Classroom Video 1" }
  }
}
```

## Changes

### 1. Add `updateSchoologyLink()` — insert after `updateStatus()` (line 294)

```js
export function updateSchoologyLink(unit, lesson, linkKey, statusObj) {
  if (typeof linkKey !== "string" || !linkKey.trim()) {
    throw new Error(`Invalid linkKey: "${linkKey}". Must be a non-empty string.`);
  }

  if (!isPlainObject(statusObj)) {
    throw new Error(`statusObj must be a plain object. Received: ${typeof statusObj}`);
  }

  return upsertLesson(unit, lesson, {
    schoologyLinks: {
      [linkKey]: statusObj,
    },
  });
}
```

### 2. Add `getSchoologyLinks()` — insert right after `updateSchoologyLink()`

```js
export function getSchoologyLinks(unit, lesson) {
  const entry = getLesson(unit, lesson);
  if (!entry || !isPlainObject(entry.schoologyLinks)) {
    return null;
  }
  return entry.schoologyLinks;
}
```

### 3. Do NOT modify `createDefaultEntry()`

The `schoologyLinks` field is optional — it only appears once `updateSchoologyLink()` is called. `deepMerge()` handles the upsert naturally. Do NOT add `schoologyLinks` to the default entry template.

## Constraints

- Do NOT modify any existing functions
- Do NOT change `STATUS_KEYS`, `URL_KEYS`, or `STATUS_VALUES` sets
- Place the two new functions after `updateStatus()` (line 294) and before `computeUrls()` (line 296)
- Both functions must be `export`ed
- Use existing `isPlainObject()`, `upsertLesson()`, and `getLesson()` helpers — do not duplicate logic

## Verification

```bash
node --check scripts/lib/lesson-registry.mjs
node -e "import('./scripts/lib/lesson-registry.mjs').then(m => { console.log('updateSchoologyLink:', typeof m.updateSchoologyLink); console.log('getSchoologyLinks:', typeof m.getSchoologyLinks); })"
```

Expected output:
```
updateSchoologyLink: function
getSchoologyLinks: function
```
