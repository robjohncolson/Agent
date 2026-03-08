# Agent: lesson-prep-wire

## Task

Modify `scripts/lesson-prep.mjs` to:
1. Auto-add `--heal` flag when re-running step 6 and registry shows previous failure
2. Import and use TUI utilities (`createSpinner`, `stepBanner`, `formatStatus`) from `tui.mjs` for step 6 headers and summary

## File to modify

`scripts/lesson-prep.mjs` (1866 lines)

## Current state — Step 6 (lines 1816-1848)

```js
  // Step 6: Post to Schoology
  const step6Resume = canResume(existingEntry, "schoology", null, opts.force);
  if (opts.skipSchoology) {
    console.log("=== Step 6: Schoology posting skipped (--skip-schoology) ===\n");
  } else if (step6Resume.skip) {
    console.log(`=== Step 6: Schoology posting — ${step6Resume.reason} (registry) ===\n`);
  } else {
    const schoologyOk = step6_postToSchoology(unit, lesson, blooketUrl, calendarContext);
    updateStatus(unit, lesson, "schoology", schoologyOk ? "done" : "failed");
    ...
  }
```

The `step6_postToSchoology` function (line 1236) builds the CLI args and runs `post-to-schoology.mjs` via `execSync`. The key part (lines 1244-1266):

```js
  const args = [`--unit ${unit}`, `--lesson ${lesson}`, `--auto-urls`, `--with-videos`, `--no-prompt`];
  if (blooketUrl) { args.push(`--blooket "${blooketUrl}"`); }
  const regEntry = getLesson(unit, lesson);
  if (regEntry?.urls?.schoologyFolder) {
    args.push(`--target-folder "${regEntry.urls.schoologyFolder}"`);
  } else if (calendarContext && calendarContext.folderTitle) {
    args.push(`--create-folder "${calendarContext.folderTitle}"`);
    ...
  }
```

## Changes

### 1. Add imports (at top of file, around line 48)

Add to the existing imports from `./lib/lesson-registry.mjs` (line 42-48):
```js
import { getSchoologyLinks } from "./lib/lesson-registry.mjs";
```

The current import is:
```js
import {
  upsertLesson,
  updateUrl,
  updateStatus,
  computeUrls,
  getLesson,
} from "./lib/lesson-registry.mjs";
```

Add `getSchoologyLinks` to this import list.

Also add:
```js
import { createSpinner, stepBanner, formatStatus as tuiFormatStatus } from "./lib/tui.mjs";
```

Note: Use `tuiFormatStatus` alias to avoid conflict if there's any local `formatStatus` usage (there isn't one in lesson-prep.mjs, but the alias is safer).

### 2. Auto-detect heal mode in `step6_postToSchoology()` (line 1236)

After building the initial `args` array (line 1244), add heal-mode detection:

```js
  // Auto-heal: add --heal when previous run failed or has missing links
  const healEntry = getLesson(unit, lesson);
  const needsHeal = healEntry?.status?.schoology === "failed"
    || (() => {
      const scLinks = healEntry?.schoologyLinks;
      if (!scLinks) return false;
      return Object.values(scLinks).some(
        (l) => l && (l.status === "failed" || !l.status)
      );
    })();

  if (needsHeal) {
    args.push("--heal");
    console.log("  [auto-heal] Previous Schoology posting incomplete — adding --heal flag");
  }
```

Insert this after line 1244 (`const args = [...]`) and before the `if (blooketUrl)` check.

### 3. Add TUI step banner for step 6 (lines 1816-1822)

Replace the plain step 6 console.log headers with TUI versions:

Replace:
```js
    console.log("=== Step 6: Schoology posting skipped (--skip-schoology) ===\n");
```
With:
```js
    console.log(stepBanner(6, "Schoology posting skipped (--skip-schoology)") + "\n");
```

Replace:
```js
    console.log(`=== Step 6: Schoology posting — ${step6Resume.reason} (registry) ===\n`);
```
With:
```js
    console.log(stepBanner(6, `Schoology posting — ${step6Resume.reason} (registry)`) + "\n");
```

### 4. Add per-link summary after step 6 completes

After `updateStatus(unit, lesson, "schoology", schoologyOk ? "done" : "failed");` (line 1824), add:

```js
    // Show per-link status summary
    const postScLinks = getSchoologyLinks(unit, lesson);
    if (postScLinks) {
      console.log("  Schoology link status:");
      for (const [key, entry] of Object.entries(postScLinks)) {
        const st = entry?.status || "unknown";
        console.log(`    ${key.padEnd(16)} ${tuiFormatStatus(st)}`);
      }
    }
```

## Constraints

- Only modify `scripts/lesson-prep.mjs`
- The heal detection must be inside `step6_postToSchoology()`, NOT in the main flow
- Do NOT change the `canResume()` logic or the skip conditions
- Import `getSchoologyLinks` by adding it to the existing registry import (don't create a duplicate import line)
- Import `createSpinner`, `stepBanner`, `formatStatus` from `./lib/tui.mjs` (alias formatStatus as `tuiFormatStatus`)
- Only modify step 6 — do not change any other steps

## Verification

```bash
node --check scripts/lesson-prep.mjs
```
