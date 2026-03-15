# Spec: Merge Supabase Sync Into the Real Roadmap Calendar

## Goal

Apply the live Supabase sync behavior to the existing System 7 roadmap page:

- Target page: `C:/Users/ColsonR/apstats-live-worksheet/ap_stats_roadmap_square_mode.html`
- Do not build or keep a second primary calendar UI
- No code in this task; this is the implementation spec

## Core Decision

The roadmap page already owns the calendar.

Supabase should be a live overlay on top of the roadmap's existing data model, not a replacement for it.

Three sources of truth stay separate:

| Source | Owns | Must remain authoritative |
|---|---|---|
| `S` array in `ap_stats_roadmap_square_mode.html` | Day layout, Period B/E per day, due/assigned homework, review/off/exam/post days, combined-topic days like `6.4+6.5` | Yes |
| `roadmap-data.json` / `BAKED_REGISTRY` | Materials URLs, lesson readiness (`ready/partial/pending`), per-period snapshot data | Yes |
| Supabase `topic_schedule` | Live Schoology posting state and live folder IDs per atomic topic and period | Yes, but only for sync fields |

## Why the Standalone `calendar.html` Was the Wrong Target

`calendar.html` only provides four useful behaviors:

1. Fetch `topic_schedule` live from Supabase
2. Read/write `?period=B|E`
3. Display `scheduled/posted/taught`
4. Use live `schoology_folder_id`

Everything else in that page is a weaker substitute for what the roadmap already has.

It does not know about:

- homework due/assigned text
- `OFF`, `EX`, `PO`, `NC`, or review days
- combined-topic cells already encoded in `S`
- roadmap resource panel
- roadmap tooltip logic
- roadmap material readiness
- baked/offline fallback

## Non-Negotiable Constraints

### 1. Keep `S` as the schedule backbone

Do not replace the roadmap grid with Supabase dates.

Reason:

- `S` contains data Supabase does not have
- `S` already encodes special day types
- `S` already handles combined-topic cells
- roadmap rendering depends on `S`

### 2. Do not overwrite roadmap lesson readiness with Supabase status

Current roadmap `lesson.status` means:

- `ready`: materials are complete
- `partial`: some materials exist
- `pending`: no usable materials yet

Supabase `topic_schedule.status` means:

- `scheduled`: not yet posted to Schoology
- `posted`: posted to Schoology
- `taught`: future extension, not currently driven by the pipeline

These are different axes. They must not be collapsed into one field.

## Required Merge Strategy

### Phase 1: Add a live Supabase overlay to the roadmap page

**Primary touchpoints in** `ap_stats_roadmap_square_mode.html`:

- `loadRegistry()`
- `setP()`
- tooltip generation in `sTip()`
- resource panel generation in `showResourcePanel()`

### Phase 1A: Load order

Boot sequence should become:

1. Read `?period=` and set `cP` before first meaningful render
2. Render immediately from baked registry / `roadmap-data.json` as the page already does
3. After `loadRegistry()` finishes, fetch live Supabase data for the active period
4. Merge live sync fields into in-memory `REGISTRY`

Important:

The Supabase overlay must happen after `loadRegistry()`. If it runs first, the later `REGISTRY = await resp.json()` assignment will overwrite the live overlay.

### Phase 1B: Data to fetch

Query exactly what `calendar.html` already uses:

```text
GET {SUPABASE_URL}/rest/v1/topic_schedule
  ?period=eq.{period}
  &select=topic,date,title,status,schoology_folder_id
  &order=date.asc
Headers:
  apikey: {ANON_KEY}
```

Use the same public anon key and Supabase URL currently embedded in `calendar.html`.

### Phase 1C: What to merge

For each Supabase row:

1. Find `REGISTRY.lessons[row.topic]`
2. Find `lesson.periods[period]`
3. Update only the live sync fields for that period

Recommended merge shape:

```text
lesson.periods[period].schoologyFolder = full Schoology URL from folder ID
lesson.periods[period].posted = row.status === 'posted' || row.status === 'taught'
lesson.periods[period].syncStatus = row.status
lesson.periods[period].syncSource = 'supabase'
```

Do not overwrite:

- `lesson.status`
- `lesson.urls`
- `lesson.topic`
- `lesson.periods[period].verified`
- any calendar structure in `S`

### Phase 1D: Folder URL construction

Supabase stores raw folder IDs, not full URLs.

Build the live folder URL from the existing roadmap constants:

- `SCHOOLOGY_COURSE_B`
- `SCHOOLOGY_COURSE_E`

Format:

```text
https://lynnschools.schoology.com/course/{courseId}/materials?f={folderId}
```

If `schoology_folder_id` is null, leave the existing folder URL untouched.

### Phase 1E: Composite topic days

The roadmap contains cells like `6.4+6.5` and `7.8+7.9`.
Supabase stores atomic rows like `6.4`, `6.5`, `7.8`, `7.9`.

This is acceptable because the roadmap already has `getAllRegistryEntries()` for split-topic cells.

When reading live sync state for a composite cell:

- `schoologyFolder`: use the first non-null folder among the atomic entries for the active period
- `posted` / `syncStatus`: aggregate across all atomic entries

Recommended aggregation:

- all posted/taught -> `Posted`
- some posted/taught -> `Partially Posted`
- none posted/taught -> `Scheduled`

## UI Behavior

### Keep the current roadmap readiness indicator

The existing green/orange dot and `Ready / Partial / Pending` tooltip text should continue to represent materials readiness only.

Do not reinterpret that dot as Schoology sync state.

### Add Schoology sync state as a separate readout

Add a separate line in the tooltip and resource panel context:

- `Schoology: Scheduled`
- `Schoology: Posted`
- `Schoology: Partially Posted`
- `Schoology: Taught` if that state ever appears

This gives the roadmap the useful live Supabase signal without breaking the meaning of existing readiness UI.

### Live folder link behavior

The roadmap already renders `View on Schoology` from `regEntry.periods[cP].schoologyFolder`.

Because the overlay updates that field in memory, the existing resource panel and tooltip link logic can keep the same UX, but it should resolve the link from the merged live period data when available.

### No standalone `calendar.html` styling should be ported

Do not import:

- its full-page layout
- its legends
- its loading banner
- its card border color system

This merge is about live sync behavior, not replacing the roadmap UI.

## Period Deep-Linking

Add the `calendar.html` period-link behavior to the roadmap page:

### Requirements

1. Read `?period=` on page load
2. Accept only `B` or `E`
3. Default to `B` if missing or invalid
4. When `setP()` runs, update the URL with `history.replaceState`

### Behavior on toggle

When the user switches periods:

1. Update `cP`
2. Update button state
3. Re-render the roadmap as it already does
4. Refresh the Supabase overlay for the newly active period

## Fetching and Cache Policy

Use a small in-memory cache keyed by period.

Recommended behavior:

- Cache `B` and `E` separately
- Reuse cached data immediately when toggling
- Re-fetch if cache is missing or older than about 60 seconds

Reason:

- avoids needless repeated requests while flipping periods
- still lets recent Schoology posts show up during the same browser session

## Failure Behavior

Supabase must be an enhancement layer, not a dependency.

If the fetch fails:

- keep the roadmap fully usable
- keep baked/runtime registry data
- do not blank the page
- do not block interaction
- log to console or fail silently

The roadmap should still work offline or when Supabase is unavailable.

## Schoology Link Migration

Update the existing link automation in:

- `C:/Users/ColsonR/Agent/scripts/update-calendar-links.mjs`

Change the destination URLs from:

- `.../calendar.html?period=B`
- `.../calendar.html?period=E`

to:

- `https://robjohncolson.github.io/apstats-live-worksheet/ap_stats_roadmap_square_mode.html?period=B`
- `https://robjohncolson.github.io/apstats-live-worksheet/ap_stats_roadmap_square_mode.html?period=E`

Then run the existing script to update both Schoology courses.

## What to Do With `calendar.html`

Do not hard-delete it in the same change.

Safer decommission plan:

1. Update Schoology links to the roadmap URL
2. Verify the roadmap deep links work for both periods
3. Convert `calendar.html` into a lightweight compatibility redirect to the roadmap page
4. Delete it only later, after existing bookmarks and old links are no longer a concern

Reason:

Immediate deletion risks breaking existing Schoology links, bookmarks, or copied URLs.

## Optional Follow-Up

If offline freshness becomes important, update:

- `C:/Users/ColsonR/Agent/scripts/build-roadmap-data.mjs`

so the generated `roadmap-data.json` can optionally hydrate `periods[period].posted` and `schoologyFolder` from Supabase before injection.

This is not required for the first merge because the runtime overlay already solves the real problem.

## Acceptance Criteria

The merge is complete when all of these are true:

1. `ap_stats_roadmap_square_mode.html?period=B` opens Period B selected
2. `ap_stats_roadmap_square_mode.html?period=E` opens Period E selected
3. The roadmap still renders from `S`, including review/off/exam/no-class cells
4. Materials readiness dot behavior is unchanged
5. Schoology folder links on the roadmap update from live Supabase data without rebuilding `roadmap-data.json`
6. Tooltip/resource panel can show live Schoology posting state separately from materials readiness
7. Switching periods uses the correct live folder and posting state for that period
8. Old `calendar.html` traffic still lands somewhere valid during the transition

## Files Expected To Change During Implementation

Required:

- `C:/Users/ColsonR/apstats-live-worksheet/ap_stats_roadmap_square_mode.html`
- `C:/Users/ColsonR/Agent/scripts/update-calendar-links.mjs`

Likely:

- `C:/Users/ColsonR/apstats-live-worksheet/calendar.html` (redirect/deprecation page)

Optional follow-up:

- `C:/Users/ColsonR/Agent/scripts/build-roadmap-data.mjs`

## Out of Scope

- moving the `S` array into Supabase
- replacing the roadmap UI with the standalone calendar layout
- changing the meaning of `ready/partial/pending`
- adding new Schoology verification logic
- making Supabase the only data source for the roadmap
