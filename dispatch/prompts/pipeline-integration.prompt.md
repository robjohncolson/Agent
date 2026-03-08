# Agent: pipeline-integration

## Goal

Wire the new `validate-blooket-csv.mjs` and `lesson-registry.mjs` modules into the existing pipeline scripts. Modify 4 files:

1. `scripts/lesson-prep.mjs` — main orchestrator
2. `scripts/upload-blooket.mjs` — Blooket upload
3. `scripts/post-to-schoology.mjs` — Schoology posting
4. `scripts/lesson-urls.mjs` — URL generator

## IMPORTANT: Read the new library files first

Before modifying anything, read these files (they were created by earlier agents in this batch):
- `scripts/lib/validate-blooket-csv.mjs` — exports `validateBlooketCsv(csvPath)` and `autoFixBlooketCsv(csvPath)`
- `scripts/lib/lesson-registry.mjs` — exports `loadRegistry`, `saveRegistry`, `getLesson`, `setLesson`, `upsertLesson`, `updateUrl`, `updateStatus`, `computeUrls`, `REGISTRY_PATH`

Read these files to understand their exact API before making changes.

## File 1: scripts/lesson-prep.mjs

### Add imports (near line 40, after existing imports)

```js
import { validateBlooketCsv, autoFixBlooketCsv } from "./lib/validate-blooket-csv.mjs";
import { upsertLesson, updateUrl, updateStatus, computeUrls, getLesson } from "./lib/lesson-registry.mjs";
```

### Registry initialization (after Step 0 completes, before Step 1)

After the unit/lesson are determined (after the `parseArgs` and Step 0 logic), add:

```js
// Initialize registry entry with computed URLs
const computedUrls = computeUrls(unit, lesson);
upsertLesson(unit, lesson, {
  topic: calendarContext?.folderTitle || `Topic ${unit}.${lesson}`,
  date: calendarContext?.date || null,
  urls: computedUrls,
});
```

### After each pipeline step, update registry status

Add `updateStatus(unit, lesson, stepKey, "done")` calls after each successful step:
- After Step 1 (ingest): `updateStatus(unit, lesson, "ingest", "done")`
- After Step 2 worksheet task succeeds: `updateStatus(unit, lesson, "worksheet", "done")`
- After Step 2 drills task succeeds: `updateStatus(unit, lesson, "drills", "done")`
- After Step 2 Blooket CSV task succeeds: `updateStatus(unit, lesson, "blooketCsv", "done")`
- After Step 5 (Blooket upload): `updateStatus(unit, lesson, "blooketUpload", "done")` AND `updateUrl(unit, lesson, "blooket", blooketUrl)`
- After Step 6 (Schoology): `updateStatus(unit, lesson, "schoology", "done")`

On failure of any step, call `updateStatus(unit, lesson, stepKey, "failed")`.

### CSV validation in Step 2 (after Blooket CSV generation)

Find the `validateBlooketTask` function (around line 700). Replace it with enhanced validation:

```js
function validateBlooketTask(unit, lesson) {
  const blooketPath = path.join(WORKING_DIRS.worksheet, `u${unit}_l${lesson}_blooket.csv`);

  // First, try auto-fix
  const fixResult = autoFixBlooketCsv(blooketPath);
  if (fixResult.fixed) {
    console.log("    Auto-fix applied:");
    fixResult.changes.forEach(c => console.log(`      - ${c}`));
  }

  // Then validate
  const result = validateBlooketCsv(blooketPath);
  if (result.valid) {
    console.log("    Validation: Blooket CSV OK (all checks passed)");
    return { ok: true };
  }

  console.log("    Validation FAILED:");
  result.errors.forEach(e => console.log(`      - ${e}`));
  return { ok: false, error: result.errors.join("; ") };
}
```

### Resume support (optional but valuable)

At the very beginning of the pipeline run (before Step 1), check registry for existing status:

```js
const existingEntry = getLesson(unit, lesson);
if (existingEntry) {
  console.log(`Registry: Found existing entry for ${unit}.${lesson}`);
  const status = existingEntry.status || {};
  // Show what's already done
  for (const [step, state] of Object.entries(status)) {
    if (state === "done") console.log(`  ${step}: already done`);
  }
}
```

Don't skip steps automatically yet — just show the status. Users can manually skip with `--skip-*` flags later.

## File 2: scripts/upload-blooket.mjs

### Add imports

At the top, add:
```js
import { updateUrl, updateStatus } from "./lib/lesson-registry.mjs";
```

### After successful upload, write to registry

In the main function, after the Blooket URL is captured and before the script exits, add:

```js
// Write to lesson registry
updateUrl(unit, lesson, "blooket", blooketUrl);
updateStatus(unit, lesson, "blooketUpload", "done");
console.log(`Registry: saved Blooket URL for ${unit}.${lesson}`);
```

### On failure, mark failed in registry

In the catch block:
```js
updateStatus(unit, lesson, "blooketUpload", "failed");
```

### Idempotency check

At the start of the upload function, before doing anything with Playwright, check:
```js
import { getLesson } from "./lib/lesson-registry.mjs";

// Check if already uploaded
const existing = getLesson(unit, lesson);
if (existing?.urls?.blooket && existing?.status?.blooketUpload === "done") {
  console.log(`Blooket already uploaded for ${unit}.${lesson}: ${existing.urls.blooket}`);
  console.log("Use --force to re-upload.");
  // Check if --force was passed
  if (!args.force) {
    console.log(existing.urls.blooket);  // Print URL for capture by lesson-prep
    return;
  }
}
```

Add `--force` to the argument parser if it doesn't exist.

## File 3: scripts/post-to-schoology.mjs

### Add imports

```js
import { getLesson, updateStatus } from "./lib/lesson-registry.mjs";
```

### Read Blooket URL from registry as fallback

In the section where the Blooket URL is determined (the `--auto-urls` handling), add a registry fallback before prompting the user:

```js
// If --blooket not provided, check registry
if (!blooketUrl) {
  const entry = getLesson(unit, lesson);
  if (entry?.urls?.blooket) {
    blooketUrl = entry.urls.blooket;
    console.log(`Using Blooket URL from registry: ${blooketUrl}`);
  }
}
```

### After successful posting, update registry

```js
updateStatus(unit, lesson, "schoology", "done");
```

## File 4: scripts/lesson-urls.mjs

### Add imports

```js
import { getLesson, computeUrls } from "./lib/lesson-registry.mjs";
```

### Use registry for Blooket URL

Replace the hardcoded placeholder:

```js
// Check registry for Blooket URL
const registryEntry = getLesson(unit, lesson);
const blooketUrl = registryEntry?.urls?.blooket
  || "[upload CSV to blooket.com and paste URL here]";
```

### Use computeUrls for deterministic URLs

Optionally use `computeUrls` but keep the existing logic as-is for now (it already computes them). The main win here is the Blooket URL from registry.

## Constraints

- Don't change the overall structure of any file — only add imports and insert registry/validation calls
- Don't remove any existing functionality
- Keep all existing CLI flags working
- ES module syntax
- No external dependencies
