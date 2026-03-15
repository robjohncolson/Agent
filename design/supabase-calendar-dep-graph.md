# Supabase Calendar Integration — Dependency Graph

## Pre-Step (manual): Create Supabase table + get anon key

1. Run `dispatch/prompts/supabase-calendar/step0-create-table.sql` in Supabase SQL Editor.
   Creates `topic_schedule` table, unique constraint, indexes, and RLS policies.
2. Anon key is now baked into Agent B's prompt — no placeholder needed.

## Wave 1 (independent, parallel)

### Agent A: supabase-schedule.mjs (CRUD wrapper)
- Creates `scripts/lib/supabase-schedule.mjs`
- Exports `getSchedule(period)`, `upsertTopic(...)`, `bulkSync(...)`
- Uses plain fetch against Supabase REST API (same pattern as `supabase-client.mjs`)
- No dependencies on other agents

### Agent B: calendar.html (dynamic page)
- Creates `calendar.html` in apstats-live-worksheet repo
- Self-contained HTML + inline JS, no build step
- Fetches `topic_schedule` from Supabase (anon key)
- Ports `determineSchoolWeek()` logic to browser JS
- Period selector (B/E), week grid, status color-coding
- No dependencies on other agents

## Wave 2 (depends on Wave 1)

### Agent C: sync-schedule-to-supabase.mjs (migration script)
- Depends on: Agent A (supabase-schedule.mjs must exist)
- Creates `scripts/sync-schedule-to-supabase.mjs`
- Reads `config/topic-schedule.json` + `state/lesson-registry.json` + `units.js` (for real topic titles)
- Per-row `upsertTopic()` with enriched fields: date, title (from units.js description), status, schoologyFolderId
- Supports `--execute` flag (dry-run by default)

### Agent D: resolve-folder-path.mjs (Supabase-first lookup) + all caller updates
- Depends on: Agent A (supabase-schedule.mjs must exist)
- Modifies `scripts/lib/resolve-folder-path.mjs`:
  - Import `getSchedule` from `./supabase-schedule.mjs`
  - Add async `loadScheduleFromSupabase(period)` with try/catch fallback
  - Change priority chain: explicit --date → Supabase → topic-schedule.json → registry
  - `resolveFolderPath()` becomes `async`
  - `loadSchedule()` remains as offline fallback
- Modifies 3 additional files to add `await` at all 6 call sites:
  - `scripts/post-to-schoology.mjs` — lines ~607, ~655
  - `scripts/lesson-prep.mjs` — lines ~1304, ~1714
  - `scripts/verify-u6-drills.mjs` — lines ~141, ~280

### Agent E: post-to-schoology.mjs (upsert folder ID)
- Depends on: Agent A (supabase-schedule.mjs must exist)
- Modifies `scripts/post-to-schoology.mjs`:
  - Import `upsertTopic` from `./lib/supabase-schedule.mjs`
  - After folder creation/reuse succeeds (3 code paths), call:
    ```js
    await upsertTopic(topicKey, currentPeriod, {
      status: 'posted',
      schoologyFolderId: folderId,
    });
    ```
  - Wrap in try/catch — Supabase failure should not block posting

## Wave 3 (depends on Wave 2)

### Execute migration
- Depends on: Agent A (CRUD wrapper) + Agent C (migration script) + pre-step (table exists)
- Run `node scripts/sync-schedule-to-supabase.mjs --execute`
- Populates all rows from `topic-schedule.json` + `lesson-registry.json`
- Must complete before verification — calendar page is empty without data,
  and Agent E's folder writeback only sends `status` + `schoologyFolderId`
  (no `date`), so rows must already exist from the migration

## Post-Step (manual)

- ~~Replace `TODO_ANON_KEY` in `calendar.html`~~ — DONE: real anon key baked in at line 259
- Update Schoology "CALENDAR" links to point to new `calendar.html?period=B` / `?period=E`
- Verify with 7.8 ingest (next in pipeline)

**Critical prerequisite**: `node scripts/sync-schedule-to-supabase.mjs --execute` must have run before any Supabase-backed verification or posting. The poster's folder writeback only sends `status` + `schoologyFolderId` (no `date`), so rows must already exist from the migration.
