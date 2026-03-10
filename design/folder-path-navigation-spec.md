# Schoology Folder Path Navigation — Spec

## Problem

The lesson-prep pipeline creates day folders at the Schoology materials root level.
Period B uses a nested hierarchy: `Q3 → week 24 → Wednesday 3/11/26`. The user
manually moves day folders into the correct week folder after each lesson.

## Goal

The pipeline should navigate into the correct quarter/week hierarchy and create the
day folder there, eliminating the manual folder move step.

## Folder Hierarchy (Period B)

```
Materials (root)
├── Q3
│   ├── week 23  (Mar 2-6, most recent)
│   ├── week 22  (Feb 26-27)
│   ├── week 21
│   └── week 20  (Feb 2-6)
├── Monday 3/9/26    ← orphaned at root (should be in week 24)
└── work-ahead/future
```

## Solution

### Part 1: `navigatePath()` in schoology-dom.mjs

Add a shared `navigatePath()` function that traverses a folder path:

```js
export async function navigatePath(page, courseId, pathSegments, { createMissing = false } = {})
```

- Takes an array of folder name segments (e.g., `["Q3", "week 24"]`)
- For each segment: navigate to current level, find folder by name
- If `createMissing` and folder not found: create it, extract ID, continue
- Returns the final folder ID
- Throws if folder not found and `createMissing` is false

### Part 2: `--folder-path` in post-to-schoology.mjs

Add a new CLI option:

```
--folder-path "Q3/week 24"    Navigate into this folder hierarchy before creating day folder
```

Behavior:
1. Parse path by splitting on `/`
2. Call `navigatePath(page, courseId, segments, { createMissing: true })`
3. Navigate to resolved folder
4. Create the day folder inside it (existing `--create-folder` logic)
5. Post links into the day folder

### Part 3: Week number detection in lesson-prep.mjs

Add a helper to determine the school week number:

```js
function determineSchoolWeek(targetDate, existingWeeks)
```

- Probe Q3 folder to find existing week folders and their dates
- The most recent week's Monday + 7 days = next week's Monday
- If target date falls in the next week, increment week number
- Return `{ quarter: "Q3", weekNum: 24 }`

### Part 4: Wire into lesson-prep.mjs pipeline

For Period B posting in Step 6:
- Calculate quarter and week number
- Pass `--folder-path "Q3/week {N}"` to post-to-schoology.mjs
- The day folder gets created inside the week folder automatically

Period E keeps existing behavior (no folder path — posts at root or existing folder).

## Week Number Calculation

Based on observed data:
- week 20: Feb 2-6 (Monday Feb 2)
- week 23: Mar 2-6 (Monday Mar 2)
- Target: Mar 11 → Monday of week = Mar 9

Formula:
```
lastKnownWeek = 23, lastKnownMonday = Mar 2
targetMonday = Mar 9
weekNum = lastKnownWeek + ((targetMonday - lastKnownMonday) / 7)
         = 23 + 1 = 24
```

Fallback if no week folders exist: scan day folders for dates and estimate.

## Non-goals

- Moving existing orphaned day folders into their correct weeks (manual or separate script)
- Changing Period E folder structure
- Supporting arbitrary nesting beyond 3 levels (quarter/week/day)
