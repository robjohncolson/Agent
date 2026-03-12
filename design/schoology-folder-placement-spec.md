# Schoology Folder Placement Spec

## Problem

When posting lesson materials to Schoology, links are dumped into the root materials area instead of being organized into the proper folder hierarchy. This happens because:

1. **No folder flags passed when running without `--auto`**: `lesson-prep.mjs` only resolves folder context from calendar parsing (`step0_detectFromCalendar`), which requires `--auto`. Running `--unit 7 --lesson 3` skips calendar detection entirely.
2. **No topic-to-date mapping exists**: Without a date, `determineSchoolWeek()` can't compute the folder path.
3. **No future-lesson routing**: Even with a date, there's no logic to route future lessons into the `work-ahead/future` parent folder.
4. **post-to-schoology.mjs allows root posting**: When no folder flags are provided, materials post directly to root with no warning.

## Existing Folder Structure (Period E / Period B)

```
Course Root
├── S1/
│   ├── Q1/
│   │   ├── Weeks 1 - 3/
│   │   ├── Week 5/
│   │   │   └── Monday 9/29/25
│   │   └── ...
│   └── Q2/ ...
├── Q3/
│   ├── week 20/ ...
│   ├── week 23/
│   │   └── Monday 3/2/26
│   ├── week 24/
│   │   └── Wednesday 3/11/26
│   └── ...
├── work-ahead/future/
│   ├── Week 24/
│   │   └── Thursday 3/12/26
│   ├── Week 25/
│   │   └── Friday 3/20/26
│   └── Week 26/ ...
└── (orphan day folders at root — legacy)
```

### Observed Naming Conventions
- **Q3 weeks**: lowercase `week NN` (e.g., `week 23`)
- **work-ahead weeks**: title case `Week NN` (e.g., `Week 24`)
- **Day folders**: `DayName M/DD/YY` (e.g., `Monday 3/2/26`)

## Week/Quarter Calculation

Existing anchor in `lesson-prep.mjs:198-232`:
```
Week 23 = Monday March 2, 2026
Quarter assignment:
  S2:  weeks 1-20
  Q3:  weeks 21-30
  Q4:  weeks 31+
```

## Design

### 1. Topic-to-Date Schedule (`config/topic-schedule.json`)

Create a static mapping from topic numbers to scheduled dates. This is the **single source of truth** for when a topic is taught, independent of calendar HTML parsing.

```json
{
  "7.3": "2026-03-16",
  "7.4": "2026-03-17",
  "7.5": "2026-03-18",
  ...
}
```

**Population strategy:**
- Backfill from existing `lesson-registry.json` folder dates (already have ~43 lessons with dates)
- Forward-fill from calendar HTMLs (week_*_calendar.html) for upcoming lessons
- Manual override as schedule changes

A new script `scripts/build-topic-schedule.mjs` extracts dates from calendar HTMLs and registry, merges them, and writes the schedule file.

### 2. Folder Path Resolution (`scripts/lib/resolve-folder-path.mjs`)

New module that determines the correct Schoology folder path for any topic:

```javascript
export function resolveFolderPath(unit, lesson, options = {}) {
  // Returns: { folderPath: string[], dayTitle: string, isFuture: boolean }

  // Step 1: Get lesson date
  //   a) Check options.date (explicit override)
  //   b) Check config/topic-schedule.json
  //   c) Check lesson-registry.json for existing folderPath
  //   d) Fail with clear error — never silently post to root

  // Step 2: Compute week info via determineSchoolWeek(date)
  //   Returns { quarter, weekNum }

  // Step 3: Determine if future
  //   isFuture = (lessonDate > today)

  // Step 4: Build path
  //   if isFuture:
  //     folderPath = ["work-ahead/future", `Week ${weekNum}`]
  //   else:
  //     folderPath = [quarter, `week ${weekNum}`]
  //
  //   dayTitle = formatDayTitle(date)  // e.g., "Monday 3/16/26"

  // Step 5: Return
  //   { folderPath, dayTitle, isFuture, weekNum, quarter, date }
}
```

**Key rules:**
- `work-ahead/future` weeks use title case `Week NN` (matching existing convention)
- Current/past quarter weeks use lowercase `week NN` (matching existing convention)
- Day folder title format: `DayName M/DD/YY` (no zero-padding, 2-digit year)
- If no date can be resolved, **throw** — never silently post to root

### 3. Integrate into `lesson-prep.mjs`

Replace the calendar-only folder logic (lines 1359-1391 and 1770-1802) with calls to `resolveFolderPath()`:

```javascript
// Before posting to Schoology:
const folderInfo = resolveFolderPath(unit, lesson, {
  date: calendarContext?.date  // optional override from --auto
});

// Pass to post-to-schoology.mjs:
//   --folder-path "work-ahead/future/Week 25"  (or "Q3/week 24")
//   --create-folder "Monday 3/16/26"
```

This works for ALL invocation modes:
- `--auto` (calendar date flows through)
- `--unit 7 --lesson 3` (schedule lookup)
- `--unit 7 --lesson 3 --date 2026-03-16` (explicit override, new flag)

### 4. Guard in `post-to-schoology.mjs`

Add a safety check: if no folder flag is provided, **refuse to post** and exit with a clear error:

```
ERROR: No folder destination specified. Materials would post to root.
  Use --folder-path, --target-folder, or --create-folder.
  Or run via lesson-prep.mjs which resolves folders automatically.
```

This prevents accidental root-level dumping from any entry point.

### 5. Fix Period E posting

The pipeline currently posts to Period B (default course), then requires a separate manual invocation for Period E. The `lesson-prep.mjs` should post to BOTH periods automatically:

- Already handled in legacy mode (lines 1393-1430 loop over periods)
- Task runner mode: needs a second `schoology-post` step or a `--courses` flag that takes both IDs
- Simplest fix: add `--courses 7945275782,7945275798` support to `post-to-schoology.mjs`

## Files to Create

| File | Purpose |
|------|---------|
| `config/topic-schedule.json` | Topic → date mapping |
| `scripts/build-topic-schedule.mjs` | Builds schedule from calendars + registry |
| `scripts/lib/resolve-folder-path.mjs` | Folder path resolution logic |

## Files to Modify

| File | Change |
|------|--------|
| `scripts/lesson-prep.mjs` | Replace calendar-only folder logic with `resolveFolderPath()` |
| `scripts/post-to-schoology.mjs` | Add root-posting guard; add `--courses` multi-course support |
| `tasks/schoology-post.json` | Add `courses` input |

## Migration

For the 7.3 materials already posted to root:
- Run `post-to-schoology.mjs --unit 7 --lesson 3 --heal` after implementing, which moves orphaned materials into the correct folder
- Or manually move them in the Schoology UI (7 links per period)

## Testing

1. `node scripts/build-topic-schedule.mjs` — verify schedule covers 7.3-9.5
2. `node scripts/lesson-prep.mjs --unit 7 --lesson 4 --dry-run` — verify folder path resolves without `--auto`
3. `node scripts/post-to-schoology.mjs --unit 7 --lesson 4 --dry-run` — verify folder creation plan
4. Verify future lessons route to `work-ahead/future/Week NN/DayName`
5. Verify current week lessons route to `Q3/week NN/DayName`
