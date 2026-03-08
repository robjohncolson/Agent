# Agent: schoology-noprompt

## Task

Edit `scripts/post-to-schoology.mjs` to add a `--no-prompt` flag that skips interactive stdin prompts, and add a registry check to avoid re-attempting a Blooket upload that already failed.

## File to modify

`scripts/post-to-schoology.mjs`

## Problem

When `lesson-prep.mjs` invokes `post-to-schoology.mjs` via `execSync`, and the Blooket upload fails, the script falls back to `promptUser("Enter Blooket URL (or press Enter to skip): ")` which blocks on stdin. In a non-interactive context (TUI menu, automated pipeline), this causes an `ETIMEDOUT` error and crashes Step 6.

Additionally, when Step 5 (Blooket upload) already failed, Step 6 re-attempts the same upload unnecessarily.

## Changes

### 1. Add `--no-prompt` flag to arg parsing

In the `parseArgs()` function (starts at line 57), add a new variable and flag:

After line 73 (`let calendarTitle = null;`), add:
```js
let noPrompt = false;
```

In the for loop, after the `--calendar-title` handler (after line 107), add:
```js
} else if (arg === "--no-prompt") {
  noPrompt = true;
}
```

Add `noPrompt` to the return object on line 134:
```js
return { unit, lesson, worksheetUrl, drillsUrl, quizUrl, blooketUrl, autoUrls, only, courseId, dryRun, createFolder, folderDesc, withVideos, calendarLink, calendarTitle, noPrompt };
```

Add to the usage text (around line 129, before the closing `\n"`):
```
"  --no-prompt       Skip interactive prompts (for automated/pipeline use)\n" +
```

### 2. Skip promptUser when non-interactive

In the `main()` function, find the section around line 531-537 where `promptUser` is called:

```js
      if (autoUrl) {
        blooketUrl = autoUrl;
        links.push({ key: "blooket", url: autoUrl, title: titles.blooket });
      } else {
        const blooketInput = await promptUser("Enter Blooket URL (or press Enter to skip): ");
        if (blooketInput) {
          blooketUrl = blooketInput;
          links.push({ key: "blooket", url: blooketInput, title: titles.blooket });
        } else {
          console.log("  Skipping Blooket (no URL provided).");
        }
      }
```

Replace the `else` block (the `promptUser` branch) with:

```js
      } else if (opts.noPrompt || !process.stdin.isTTY) {
        console.log("  Skipping Blooket URL prompt (non-interactive mode).");
      } else {
        const blooketInput = await promptUser("Enter Blooket URL (or press Enter to skip): ");
        if (blooketInput) {
          blooketUrl = blooketInput;
          links.push({ key: "blooket", url: blooketInput, title: titles.blooket });
        } else {
          console.log("  Skipping Blooket (no URL provided).");
        }
      }
```

### 3. Check registry before re-attempting Blooket upload

In the auto-upload section (around lines 502-526), before the `try` block that calls `upload-blooket.mjs`, add a registry check:

Find this code (approximately lines 502-506):
```js
    } else {
      // Try auto-uploading the Blooket CSV via upload-blooket.mjs
      const csvPath = join(WORKSHEET_REPO, `u${unit}_l${lesson}_blooket.csv`);
      const uploadScript = SCRIPTS.uploadBlooket;
      let autoUrl = null;
```

Replace with:
```js
    } else {
      // Try auto-uploading the Blooket CSV via upload-blooket.mjs
      const csvPath = join(WORKSHEET_REPO, `u${unit}_l${lesson}_blooket.csv`);
      const uploadScript = SCRIPTS.uploadBlooket;
      let autoUrl = null;

      // Skip re-attempt if Blooket upload already failed this run
      const regEntry = getLesson(unit, lesson);
      if (regEntry?.status?.blooketUpload === "failed") {
        console.log("  Blooket upload already failed (registry), skipping re-attempt.");
```

Then close that `if` with an `} else {` that wraps the existing try/catch block, and close with `}`.

The full structure should be:
```js
    } else {
      const csvPath = join(WORKSHEET_REPO, `u${unit}_l${lesson}_blooket.csv`);
      const uploadScript = SCRIPTS.uploadBlooket;
      let autoUrl = null;

      const regEntry = getLesson(unit, lesson);
      if (regEntry?.status?.blooketUpload === "failed") {
        console.log("  Blooket upload already failed (registry), skipping re-attempt.");
      } else {
        try {
          // ... existing auto-upload try/catch ...
        } catch (e) {
          console.log(`  Blooket auto-upload failed: ${e.message}`);
        }
      }

      if (autoUrl) {
        // ... existing autoUrl handling
      } else if (opts.noPrompt || !process.stdin.isTTY) {
        console.log("  Skipping Blooket URL prompt (non-interactive mode).");
      } else {
        // ... existing promptUser handling
      }
    }
```

## Important: `getLesson` is already imported

Line 34 already has:
```js
import { getLesson, updateStatus } from "./lib/lesson-registry.mjs";
```

So no new imports are needed.

## Constraints

- Only modify `scripts/post-to-schoology.mjs`
- Do NOT modify any other files
- Do NOT change the Schoology posting logic, folder creation, or CDP connection
- Do NOT remove the `promptUser` function or its import — it's still used when running interactively
- Valid ESM syntax
