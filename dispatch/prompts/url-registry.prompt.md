# Agent: url-registry

## Goal

Create the URL registry library that provides CRUD operations for `state/lesson-registry.json`.

**CREATE** `scripts/lib/lesson-registry.mjs`

## Registry file location

The registry lives at `state/lesson-registry.json` relative to the Agent repo root. Import `AGENT_ROOT` from `./paths.mjs` (same directory) to resolve the path:

```js
import { AGENT_ROOT } from "./paths.mjs";
import { join } from "node:path";

const REGISTRY_PATH = join(AGENT_ROOT, "state", "lesson-registry.json");
```

## Registry shape

The file is a JSON object keyed by `"unit.lesson"` strings:

```json
{
  "6.10": {
    "unit": 6,
    "lesson": 10,
    "topic": "Setting Up Test for p1 - p2",
    "date": "2026-03-16",
    "period": "B",
    "urls": {
      "worksheet": "https://robjohncolson.github.io/apstats-live-worksheet/u6_lesson10_live.html",
      "drills": "https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l17-hypotheses-610",
      "quiz": "https://robjohncolson.github.io/curriculum_render/?u=6&l=9",
      "blooket": null,
      "schoologyFolder": null,
      "videos": []
    },
    "status": {
      "ingest": "pending",
      "worksheet": "pending",
      "drills": "pending",
      "blooketCsv": "pending",
      "blooketUpload": "pending",
      "animations": "pending",
      "schoology": "pending"
    },
    "timestamps": {
      "created": "2026-03-08T01:00:00Z",
      "lastUpdated": "2026-03-08T01:00:00Z"
    }
  }
}
```

## Exports

### `loadRegistry()`
Read and parse `lesson-registry.json`. If file doesn't exist, return `{}`. Handle JSON parse errors gracefully (log warning, return `{}`).

### `saveRegistry(registry)`
Write the full registry object to `lesson-registry.json` with `indent: 2` and a trailing newline. Create `state/` directory if needed.

### `getLesson(unit, lesson)`
Returns the entry for `"unit.lesson"` key, or `null` if not found. Calls `loadRegistry()` internally.

### `setLesson(unit, lesson, entry)`
Sets the full entry for `"unit.lesson"` key. Calls `loadRegistry()`, merges, calls `saveRegistry()`. Auto-sets `timestamps.lastUpdated`.

### `upsertLesson(unit, lesson, partialEntry)`
Like `setLesson` but does a deep merge with existing entry. If entry doesn't exist, creates it with defaults. Always updates `timestamps.lastUpdated`. If `timestamps.created` doesn't exist, sets it.

### `updateUrl(unit, lesson, urlKey, urlValue)`
Updates a single URL in an existing entry. `urlKey` is one of: `"worksheet"`, `"drills"`, `"quiz"`, `"blooket"`, `"schoologyFolder"`, `"videos"`. Calls `upsertLesson()` under the hood.

### `updateStatus(unit, lesson, stepKey, statusValue)`
Updates a single status in an existing entry. `stepKey` is one of: `"ingest"`, `"worksheet"`, `"drills"`, `"blooketCsv"`, `"blooketUpload"`, `"animations"`, `"schoology"`. `statusValue` is one of: `"pending"`, `"running"`, `"done"`, `"failed"`, `"skipped"`, `"scraped"`.

### `computeUrls(unit, lesson)`
Returns the deterministic URLs that can be computed from unit/lesson without any pipeline run:

```js
{
  worksheet: `https://robjohncolson.github.io/apstats-live-worksheet/u${unit}_lesson${lesson}_live.html`,
  quiz: lesson > 1 ? `https://robjohncolson.github.io/curriculum_render/?u=${unit}&l=${lesson - 1}` : null,
  drills: findDrillsUrl(unit, lesson),  // reads cartridge manifest
}
```

For drills URL: read the cartridge manifest to find the first mode matching `${unit}.${lesson}`. The cartridge mapping is:
- Unit 5: `apstats-u5-sampling-dist`
- Unit 6: `apstats-u6-inference-prop`

The cartridge manifests live at `CARTRIDGES_DIR/cartridgeId/manifest.json`. Import `CARTRIDGES_DIR` from `./paths.mjs`.

The drills URL format is: `https://lrsl-driller.vercel.app/platform/app.html?c=${cartridgeId}&level=${modeId}`

If no mode is found, return `null` for drills.

### `REGISTRY_PATH`
Export the path constant so other scripts can reference it.

## Constraints

- No external dependencies
- ES module syntax (`import`/`export`)
- All functions are named exports (no default export)
- File operations use `readFileSync`/`writeFileSync` (synchronous is fine for this use case)
- Deep merge for `upsertLesson` should handle nested objects (urls, status, timestamps) but not arrays (overwrite arrays)
