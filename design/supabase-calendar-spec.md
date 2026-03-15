# Supabase Calendar Integration Spec

## Problem

The AP Stats topic schedule lives in multiple places that drift apart:

1. **`config/topic-schedule.json`** — pipeline reads this to determine folder paths and day titles
2. **Static calendar HTMLs** (`week_*_calendar.html` in apstats-live-worksheet) — students view these
3. **`state/lesson-registry.json`** — tracks what's been posted, includes dates per topic
4. **Schoology folder structure** — folder names encode dates (e.g., "Thursday 3/26/26")

When a topic is added or rescheduled, all four must be updated manually. In practice they drift — e.g., 7.7 was posted to Schoology but never added to the student-facing calendar HTML.

## Solution

Make Supabase the single source of truth for the topic schedule. The calendar becomes a dynamic page that fetches from Supabase. The pipeline reads from Supabase (with `topic-schedule.json` as offline fallback).

## Architecture

```
┌──────────────┐       ┌──────────────┐       ┌──────────────────────┐
│  Supabase    │──────▶│  Calendar    │       │  lesson-prep.mjs     │
│  topic_      │  fetch│  Page        │       │  (pipeline)          │
│  schedule    │       │  (dynamic)   │       │                      │
│              │◀──────┤              │       │  1. Read schedule    │
│              │       └──────────────┘       │  2. Post to Schoology│
│              │◀──────────────────────────────│  3. Upsert schedule  │
└──────────────┘                              └──────────────────────┘
```

## Database Schema

### Table: `topic_schedule`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `topic` | `text` | e.g., `"7.3"` |
| `period` | `text` | `"B"` or `"E"` |
| `date` | `date` | Scheduled date |
| `title` | `text` | Display title, e.g., `"Sampling Distributions for Sample Proportions"` |
| `status` | `text` | `"scheduled"`, `"posted"`, `"taught"` |
| `schoology_folder_id` | `text` | Nullable — set after posting |
| `updated_at` | `timestamptz` | Auto-updated |

**Unique constraint**: `(topic, period)` — one row per topic per period.

**RLS**: Anon read (matches existing `agent_events` / `agent_checkpoints` pattern). Service-role write from pipeline.

### Indexes

- `topic_schedule_period_date_idx` on `(period, date)` — calendar page queries by period + date range
- `topic_schedule_topic_period_idx` on `(topic, period)` — pipeline lookups

## Component Changes

### 1. New: `scripts/lib/supabase-schedule.mjs`

Thin wrapper around the `topic_schedule` table:

```javascript
export async function getSchedule(period)
// Returns Map<topic, { date, title, status, schoology_folder_id }>

export async function upsertTopic(topic, period, { date, title, status, schoologyFolderId })
// Upserts a single row

export async function bulkSync(scheduleJson, period)
// One-time migration: reads topic-schedule.json, upserts all rows
```

Uses `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from env (already available in the pipeline environment).

### 2. Modified: `scripts/lib/resolve-folder-path.mjs`

Add Supabase as the first data source in the priority chain:

```
Current:  explicit --date  →  topic-schedule.json  →  lesson-registry.json
New:      explicit --date  →  Supabase             →  topic-schedule.json (fallback)  →  registry
```

The Supabase fetch is async, so `resolveFolderPath` becomes async. Callers already `await` the pipeline steps, so this is non-breaking.

`topic-schedule.json` remains as an offline fallback (no network = still works).

### 3. Modified: `scripts/post-to-schoology.mjs`

After successfully creating/reusing a day folder, upsert the `schoology_folder_id` back to Supabase:

```javascript
// After folder creation/reuse succeeds:
await upsertTopic(topicKey, currentPeriod, {
  status: 'posted',
  schoologyFolderId: folderId,
});
```

### 4. New: Dynamic calendar page

Replace the static `week_*_calendar.html` files with a single dynamic page hosted on GitHub Pages (or the existing apstats-live-worksheet repo):

**`calendar.html`** — single page that:
1. Fetches `topic_schedule` from Supabase (anon key, public read)
2. Groups by week using the same `determineSchoolWeek` logic (ported to browser JS)
3. Renders a week-grid view with day columns and topic cards
4. Period selector (B / E) switches the view
5. Color-codes by status: scheduled (gray), posted (blue), taught (green)

No build step. No static file generation. One fetch, one render.

**URL**: `https://robjohncolson.github.io/apstats-live-worksheet/calendar.html?period=B`

The existing `CALENDAR (now to end of year)` link in Schoology gets updated to point here.

### 5. New: `scripts/sync-schedule-to-supabase.mjs`

One-time migration script:

```bash
node scripts/sync-schedule-to-supabase.mjs           # dry-run
node scripts/sync-schedule-to-supabase.mjs --execute  # upsert all rows
```

Reads `config/topic-schedule.json` and `state/lesson-registry.json`, merges dates and titles, upserts to Supabase. Idempotent.

## Migration Plan

1. Create `topic_schedule` table in Supabase with RLS policies
2. Run `sync-schedule-to-supabase.mjs --execute` to populate from existing data
3. Build `supabase-schedule.mjs` module
4. Update `resolve-folder-path.mjs` to read from Supabase first
5. Update `post-to-schoology.mjs` to write folder IDs back
6. Build `calendar.html` dynamic page
7. Update Schoology calendar links to point to new page
8. Verify with a test lesson (e.g., 7.8 which is next in the pipeline)

Steps 1-3 can be done in parallel with steps 6-7. Step 4-5 depend on step 3. Step 8 depends on all.

## Files to Create/Modify

| File | Change |
|------|--------|
| `scripts/lib/supabase-schedule.mjs` | **NEW** — Supabase schedule CRUD |
| `scripts/sync-schedule-to-supabase.mjs` | **NEW** — one-time migration |
| `scripts/lib/resolve-folder-path.mjs` | Add Supabase as primary data source |
| `scripts/post-to-schoology.mjs` | Upsert folder ID after posting |
| Calendar page (in apstats-live-worksheet repo) | **NEW** — dynamic `calendar.html` |

## Non-Goals

- **Editing UI**: No admin interface for editing the schedule. Updates come from the pipeline or direct Supabase edits.
- **Real-time subscriptions**: The calendar page does a one-shot fetch on load. No WebSocket/realtime needed.
- **Replacing the registry**: `lesson-registry.json` keeps its role for tracking materials, URLs, hashes. The schedule table only owns dates and folder IDs.
- **Historical week folders**: Existing Q1/Q2/Q3 week naming inconsistencies (Week4 vs week 9 vs Week 25) are not addressed. This spec only affects future folder placement and the calendar view.
