# Agent C: lesson-prep.mjs Integration

## Overview
Modify `scripts/lesson-prep.mjs` to use `resolveFolderPath()` from `scripts/lib/resolve-folder-path.mjs` instead of only resolving folders via calendar context.

## Dependencies
- Agent B must have created `scripts/lib/resolve-folder-path.mjs` first

## Changes to `scripts/lesson-prep.mjs`

### Change 1: Add import (near top, after existing imports around line 64)

Add this import:
```javascript
import { resolveFolderPath, determineSchoolWeek as sharedDetermineSchoolWeek } from './lib/resolve-folder-path.mjs';
```

### Change 2: Replace inline `determineSchoolWeek` (lines 198-232)

Replace the entire `determineSchoolWeek` function with a thin wrapper:

```javascript
/**
 * Determine the Schoology quarter folder and week number for a given date.
 * Delegates to shared resolve-folder-path.mjs module.
 */
function determineSchoolWeek(targetDate) {
  return sharedDetermineSchoolWeek(targetDate);
}
```

### Change 3: Modify legacy Step 6 folder resolution (lines ~1359-1391)

The current code at line 1359-1382 only builds folder args when `calendarContext` exists. Replace that block with logic that uses `resolveFolderPath()` as a fallback.

Find this code block (lines ~1359-1382):
```javascript
  // Check if folder already exists in registry (from a previous run)
  const regEntry = getLesson(unit, lesson);
  if (regEntry?.urls?.schoologyFolder) {
    args.push(`--target-folder "${regEntry.urls.schoologyFolder}"`);
  }
  // Navigate into quarter/week hierarchy, create day folder inside
  else if (calendarContext && calendarContext.folderTitle) {
    const weekInfo = calendarContext.date
      ? determineSchoolWeek(calendarContext.date)
      : null;
    if (weekInfo) {
      args.push(`--folder-path "${weekInfo.folderPath}"`);
      console.log(`  Folder path: ${weekInfo.folderPath} (${weekInfo.quarter}, week ${weekInfo.weekNum})`);
    }
    args.push(`--create-folder "${calendarContext.folderTitle}"`);
    if (calendarContext.folderDesc) {
      // Escape newlines and quotes for shell transport
      const desc = calendarContext.folderDesc
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
      args.push(`--folder-desc "${desc}"`);
    }
  }
```

Replace with:
```javascript
  // Check if folder already exists in registry (from a previous run)
  const regEntry = getLesson(unit, lesson);
  if (regEntry?.urls?.schoologyFolder) {
    args.push(`--target-folder "${regEntry.urls.schoologyFolder}"`);
  }
  // Use calendar context if available (from --auto mode)
  else if (calendarContext && calendarContext.folderTitle) {
    const weekInfo = calendarContext.date
      ? determineSchoolWeek(calendarContext.date)
      : null;
    if (weekInfo) {
      args.push(`--folder-path "${weekInfo.folderPath}"`);
      console.log(`  Folder path: ${weekInfo.folderPath} (${weekInfo.quarter}, week ${weekInfo.weekNum})`);
    }
    args.push(`--create-folder "${calendarContext.folderTitle}"`);
    if (calendarContext.folderDesc) {
      const desc = calendarContext.folderDesc
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
      args.push(`--folder-desc "${desc}"`);
    }
  }
  // Fallback: resolve folder from topic schedule (works without --auto)
  else {
    try {
      const folderInfo = resolveFolderPath(unit, lesson, {
        date: opts?.targetDate || null,
      });
      args.push(`--folder-path "${folderInfo.folderPath.join('/')}"`);
      args.push(`--create-folder "${folderInfo.dayTitle}"`);
      console.log(`  Folder resolved from schedule: ${folderInfo.folderPath.join('/')} / ${folderInfo.dayTitle}`);
      if (folderInfo.isFuture) {
        console.log(`  (future lesson — routing to work-ahead/future)`);
      }
    } catch (err) {
      console.warn(`  WARNING: Could not resolve folder: ${err.message}`);
      console.warn(`  Links will post to root unless --no-folder is set.`);
    }
  }
```

### Change 4: Modify task runner context seeding (lines ~1779-1802)

Find the task runner context seeding block. After the existing calendarContext block (lines ~1779-1793), add a fallback for when there's no calendar context:

After this block:
```javascript
    if (calendarContext) {
      if (calendarContext.folderTitle) context.set('folder_title', calendarContext.folderTitle);
      ...
    }
```

Add:
```javascript
    // Fallback: resolve folder from topic schedule when no calendar context
    if (!calendarContext || !calendarContext.folderTitle) {
      try {
        const folderInfo = resolveFolderPath(unit, lesson, {
          date: opts.targetDate || null,
        });
        context.set('folder_path', folderInfo.folderPath.join('/'));
        context.set('folder_title', folderInfo.dayTitle);
        console.log(`  Folder resolved from schedule: ${folderInfo.folderPath.join('/')} / ${folderInfo.dayTitle}`);
        if (folderInfo.isFuture) {
          console.log(`  (future lesson — routing to work-ahead/future)`);
        }
      } catch (err) {
        console.warn(`  WARNING: Could not resolve folder: ${err.message}`);
      }
    }
```

## Important notes
- The `opts` variable is available in both the legacy function (`step6_postToSchoology`) and the main function scope where task runner context is seeded
- In the legacy function, `opts` may not be directly available — check the function signature. The function takes `(unit, lesson, blooketUrl, calendarContext)`. You may need to access `opts.targetDate` from the outer scope, or add it as a parameter.
- Do NOT modify any other functions or pipeline steps

## Files to modify
- `scripts/lesson-prep.mjs`

## Files to read (context only)
- `scripts/lib/resolve-folder-path.mjs` (Agent B creates this)
- `scripts/lib/paths.mjs`
