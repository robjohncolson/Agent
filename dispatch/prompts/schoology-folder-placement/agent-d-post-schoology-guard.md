# Agent D: post-to-schoology.mjs — Root Guard + --courses

## Overview
Modify `scripts/post-to-schoology.mjs` to:
1. Refuse to post when no folder destination is specified (root-posting guard)
2. Add `--courses` flag for multi-course posting (both periods in one invocation)

## Change 1: Add `--courses` flag to arg parser

In `parseArgs()`, add a new variable and case:

After `let heal = false;` (around line 85), add:
```javascript
  let courses = null;
```

In the for loop, after the `--heal` case, add:
```javascript
    } else if (arg === '--courses') {
      courses = args[++i]; // comma-separated course IDs
    }
```

Update the return statement to include `courses`.

Also add it to the help text in the usage block:
```
        "  --courses         Comma-separated course IDs to post to all (e.g. '7945275782,7945275798')\n" +
```

## Change 2: Root-posting guard

In `main()`, after the dry-run check (around line 633-636), add this guard:

```javascript
  // Root-posting guard: refuse to post if no folder destination is specified
  const hasFolderDest = opts.createFolder || opts.targetFolder || opts.folderPath || opts.heal;
  if (!hasFolderDest) {
    console.error('\nERROR: No folder destination specified. Materials would post to Schoology root.');
    console.error('  Use --folder-path, --target-folder, or --create-folder.');
    console.error('  Or run via lesson-prep.mjs which resolves folders automatically.');
    console.error('  Use --heal to fix previously-posted root materials.');
    process.exit(1);
  }
```

This goes right after the `if (dryRun) { ... return; }` block and before the CDP connection.

## Change 3: Multi-course loop with --courses

When `--courses` is provided, the script should loop over each course ID and post all links to each. Modify `main()`:

After the guard (Change 2), wrap the existing posting logic:

```javascript
  // Determine which courses to post to
  const courseIds = opts.courses
    ? opts.courses.split(',').map(c => c.trim()).filter(Boolean)
    : [opts.courseId];

  // Connect to browser via CDP (once, shared across courses)
  console.log(`Connecting to browser via CDP...`);
  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology.com" });

  let totalSuccess = 0;
  let totalFail = 0;

  for (const currentCourseId of courseIds) {
    const currentPeriod = detectPeriod(currentCourseId);
    const currentFolderUrlKey = currentPeriod === 'E' ? 'schoologyFolderE' : 'schoologyFolder';
    const currentRootMaterialsUrl = `${CONFIG.baseUrl}/course/${currentCourseId}/materials`;

    if (courseIds.length > 1) {
      console.log(`\n${"=".repeat(50)}`);
      console.log(`  Posting to Period ${currentPeriod} (course ${currentCourseId})`);
      console.log("=".repeat(50));
    }

    // ... existing folder resolution and posting logic, but using
    // currentCourseId, currentPeriod, currentFolderUrlKey, currentRootMaterialsUrl
    // instead of courseId, period, folderUrlKey, rootMaterialsUrl
```

**IMPORTANT**: The existing code after the CDP connect (lines ~645 onward) uses `courseId`, `period`, `folderUrlKey`, `rootMaterialsUrl` as variables. These need to be replaced with the `current*` variants inside the course loop. The simplest approach:

1. Remove the existing single-course variable assignments (lines ~480-485 where `period`, `folderUrlKey`, `rootMaterialsUrl` are set)
2. Move them inside the for loop as `currentPeriod`, `currentFolderUrlKey`, `currentRootMaterialsUrl`
3. Use `currentCourseId` instead of `courseId` throughout the loop body

The approach should be:
- Move the CDP connect BEFORE the loop (connect once)
- Move ALL posting logic (folder resolution, heal, link posting, calendar link) INSIDE the loop
- Keep `links` construction (auto-URL generation, blooket) OUTSIDE and BEFORE the loop — the links themselves don't change per course
- Reset `successCount` and `failCount` per course, accumulate into `totalSuccess`/`totalFail`
- Re-clone `materialsUrl` at the start of each iteration (reset to that course's root)

At the end, update the summary to use totals, and update registry status only if all courses succeeded.

## Change 4: Update the help text

Add the new flag to the usage help output.

## Files to modify
- `scripts/post-to-schoology.mjs`

## Files to read (context only)
- `scripts/lib/schoology-dom.mjs` (for COURSE_IDS reference)
