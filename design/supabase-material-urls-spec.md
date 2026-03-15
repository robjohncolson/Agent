# Spec: Store Material URLs in Supabase

## Problem

The roadmap page depends on three static data sources for material URLs:

1. `BAKED_REGISTRY` — injected into the HTML at commit time by `build-roadmap-data.mjs`
2. `roadmap-data.json` — fetched at runtime, replaces `BAKED_REGISTRY` entirely
3. Supabase `topic_schedule` — provides sync status and folder IDs only

When `roadmap-data.json` is stale (not rebuilt after new lessons are ingested), the runtime fetch replaces the baked registry with an incomplete set. Supabase can't fill the gap because it doesn't store material URLs.

## Goal

After this change:

- Topics already present in `S` render material icons and links from Supabase, even if `roadmap-data.json` is stale or missing
- `BAKED_REGISTRY` and `roadmap-data.json` become offline fallbacks only (the `S` array remains the sole authority for which topics appear on the grid and when)
- No manual `build-roadmap-data.mjs` run is needed after lesson ingest for the live page to show correct material icons and links

## Structural Constraint: Material URLs Are Topic-Global

Material URLs (worksheet, drills, quiz, blooket) are the same for a lesson regardless of period. `build-roadmap-data.mjs` puts `lesson.urls` outside `periods`:

```
REGISTRY.lessons["7.7"] = {
  urls: { worksheet, drills, quiz, blooket },  // topic-global
  periods: {
    B: { date, schoologyFolder, posted },       // period-scoped
    E: { date, schoologyFolder, posted },       // period-scoped
  }
}
```

The existing `topic_schedule` table is keyed on `(topic, period)`. Putting material URLs on period-scoped rows creates a mismatch:

- `post-to-schoology.mjs` posts one period at a time and only upserts the active period's row
- Period B gets URLs populated; Period E stays null until its poster run
- The roadmap would show icons for B but not E, even though the assets are identical

### Decision: new `lesson_urls` table

Material URLs belong in a **topic-level** table, not on period-scoped rows.

```sql
CREATE TABLE lesson_urls (
  topic        text PRIMARY KEY,   -- "7.7"
  worksheet_url text,
  drills_url    text,
  quiz_url      text,
  blooket_url   text,
  updated_at    timestamptz DEFAULT now()
);

-- RLS: anon read (same pattern as topic_schedule)
ALTER TABLE lesson_urls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_lesson_urls" ON lesson_urls
  FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_lesson_urls" ON lesson_urls
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

The roadmap page makes two parallel fetches:
1. `topic_schedule?period=eq.{period}` — schedule + sync state (existing)
2. `lesson_urls?select=*` — material URLs for all topics (new, ~50 rows, <5KB)

### Why not JSONB or a junction table

- Exactly four material types exist in the AP Stats curriculum — flat columns document the contract
- No join needed — separate fetch, merged client-side
- No period duplication — one row per topic

## Related Bug: `urls.drills` Not Populated

The lesson registry has a data inconsistency:

```
7.7: urls.drills = NULL
     schoology.B.materials.drills.targetUrl = "https://lrsl-driller.vercel.app/..."
```

The pipeline posts drills to Schoology and records the URL in `schoology[period].materials.drills.targetUrl`, but never backfills `urls.drills`. Since `build-roadmap-data.mjs` reads from `entry.urls.drills`, the roadmap sees `null` and marks the lesson as `partial` instead of `ready`.

The backfill migration for `lesson_urls` will read from both sources, resolving this bug for the live page. A separate pipeline fix for `urls.drills` is optional — once the roadmap reads from `lesson_urls`, the stale `urls.drills` field becomes irrelevant.

## Current Supabase Schema

```sql
topic_schedule (
  id          uuid PRIMARY KEY,
  topic       text NOT NULL,       -- "7.7"
  period      text NOT NULL,       -- "B" or "E"
  date        date NOT NULL,
  title       text,                -- "Justify (Diff Means)"
  status      text DEFAULT 'scheduled',  -- scheduled/posted/taught
  schoology_folder_id text,
  updated_at  timestamptz,
  UNIQUE(topic, period)
)
```

No changes to `topic_schedule`. It keeps its current columns and purpose.

## Pipeline Write Paths

There are exactly two places the pipeline writes to Supabase today. Both are in `post-to-schoology.mjs`. Neither `lesson-prep.mjs` nor any other script calls `upsertTopic()`.

### Writer 1: `post-to-schoology.mjs:syncFolderToSupabase()` (line 44)

Called after posting materials to a Schoology folder. Currently sends:

```js
await upsertTopic(topicKey, period, {
  status: 'posted',
  schoologyFolderId: folderId,
});
```

**Change:** Extend `syncFolderToSupabase()` to accept a `materialUrls` parameter and call `upsertLessonUrls()`:

```js
async function syncFolderToSupabase(unit, lesson, period, folderId, materialUrls) {
  // ... existing upsertTopic call (unchanged) ...
  if (materialUrls) {
    await upsertLessonUrls(`${unit}.${lesson}`, materialUrls);
  }
}
```

At each of the three call sites (lines 747, 763, 797), build a **sparse** `materialUrls` object from the `links` array that is already in scope. Only include keys for URLs that are actually present in this run — do not send `null` for missing entries, or partial runs (`--only`, `--skip-missing`, no Blooket) will erase previously stored URLs:

```js
const materialUrls = {};
const wl = links.find(l => l.key === 'worksheet');
const dl = links.find(l => l.key === 'drills');
const ql = links.find(l => l.key === 'quiz');
const bl = links.find(l => l.key === 'blooket');
if (wl) materialUrls.worksheetUrl = wl.url;
if (dl) materialUrls.drillsUrl    = dl.url;
if (ql) materialUrls.quizUrl      = ql.url;
if (bl) materialUrls.blooketUrl   = bl.url;
if (sbFolderId) await syncFolderToSupabase(unit, lesson, currentPeriod, sbFolderId, materialUrls);
```

The `links` array is built at line 459 from `buildAutoUrls()` + explicit URL overrides + Blooket auto-upload. Only URLs present in this run's `links` array are forwarded — absent entries are omitted entirely so `upsertLessonUrls()` does not overwrite existing values with null. This write is topic-global, so it doesn't matter which period triggered it.

### Writer 2: backfill migration (new)

Extend `scripts/sync-schedule-to-supabase.mjs` (or create a new `scripts/backfill-lesson-urls.mjs`) to populate `lesson_urls` from the existing registry:

```
For each lesson in registry:
  worksheet = entry.urls.worksheet
  drills = entry.urls.drills
           || entry.schoology.B.materials.drills.targetUrl
           || entry.schoology.E.materials.drills.targetUrl
  quiz = entry.urls.quiz
  blooket = entry.urls.blooket
  upsertLessonUrls(topic, { worksheetUrl, drillsUrl, quizUrl, blooketUrl })
```

The drills fallback reads from per-material posting data when `urls.drills` is null.

### No lesson-prep.mjs changes needed

`lesson-prep.mjs` does not call Supabase today and does not need to start. The poster is the only write path that has material URLs in scope. For poster-skip/retry cases:

- If materials were posted in a previous run, the poster already wrote to Supabase
- If materials were never posted, there are no URLs to write
- The backfill migration covers all historical data

## CRUD Wrapper Changes: `scripts/lib/supabase-schedule.mjs`

Add a new `upsertLessonUrls()` function:

```js
export async function upsertLessonUrls(topic, fields = {}) {
  const { url, key } = getSupabaseConfig();

  const payload = { topic, updated_at: new Date().toISOString() };
  if (fields.worksheetUrl !== undefined) payload.worksheet_url = fields.worksheetUrl;
  if (fields.drillsUrl !== undefined)    payload.drills_url = fields.drillsUrl;
  if (fields.quizUrl !== undefined)      payload.quiz_url = fields.quizUrl;
  if (fields.blooketUrl !== undefined)   payload.blooket_url = fields.blooketUrl;

  const response = await fetch(
    `${url}/rest/v1/lesson_urls?on_conflict=topic`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(key),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)');
    console.warn(`[supabase-schedule] upsertLessonUrls failed: ${response.status} ${text}`);
    return { ok: false, error: text };
  }
  return { ok: true };
}
```

`upsertTopic()` is unchanged — it still only handles `topic_schedule` fields.

## Roadmap Page Changes

### Fetch: add second parallel query

```js
async function loadSupabaseOverlay(period) {
  // ... existing cache check ...
  try {
    var schedUrl = SUPABASE_URL + '/rest/v1/topic_schedule?period=eq.' + period +
      '&select=topic,date,title,status,schoology_folder_id&order=date.asc';
    var urlsUrl = SUPABASE_URL + '/rest/v1/lesson_urls?select=topic,worksheet_url,drills_url,quiz_url,blooket_url';

    var [schedResp, urlsResp] = await Promise.all([
      fetch(schedUrl, { headers: { apikey: SUPABASE_ANON_KEY } }),
      fetch(urlsUrl,  { headers: { apikey: SUPABASE_ANON_KEY } })
    ]);

    var schedRows = schedResp.ok ? await schedResp.json() : [];
    var urlsRows  = urlsResp.ok  ? await urlsResp.json()  : [];

    _supaCache[period] = { schedRows, urlsRows, ts: Date.now() };
    mergeSupabase(schedRows, urlsRows, period);
  } catch (e) { /* fail silently */ }
}
```

The `lesson_urls` fetch is not period-scoped (URLs are topic-global). It can be cached globally rather than per-period. On period toggle, the `urlsRows` cache should be reused without re-fetching.

### Merge: create missing lesson shells

```js
function mergeSupabase(schedRows, urlsRows, period) {
  if (!REGISTRY) REGISTRY = { lessons: {} };
  if (!REGISTRY.lessons) REGISTRY.lessons = {};

  // Phase 1: merge topic-global material URLs
  var courseId = period === 'B' ? SCHOOLOGY_COURSE_B : SCHOOLOGY_COURSE_E;
  for (var i = 0; i < urlsRows.length; i++) {
    var uRow = urlsRows[i];
    var lesson = REGISTRY.lessons[uRow.topic];
    if (!lesson) {
      // Create shell for topics missing from static data
      lesson = { topic: uRow.topic, urls: {}, periods: {}, status: 'pending' };
      REGISTRY.lessons[uRow.topic] = lesson;
    }
    if (!lesson.urls) lesson.urls = {};
    if (uRow.worksheet_url) lesson.urls.worksheet = uRow.worksheet_url;
    if (uRow.drills_url)    lesson.urls.drills = uRow.drills_url;
    if (uRow.quiz_url)      lesson.urls.quiz = uRow.quiz_url;
    if (uRow.blooket_url)   lesson.urls.blooket = uRow.blooket_url;

    // Do NOT recompute status here — URLs alone don't mean "ready".
    // Status is recomputed in phase 3 after both merges complete.
  }

  // Phase 2: merge period-scoped sync state (existing logic, unchanged)
  for (var j = 0; j < schedRows.length; j++) {
    var row = schedRows[j];
    var les = REGISTRY.lessons[row.topic];
    if (!les) {
      les = { topic: row.topic, urls: {}, periods: {}, status: 'pending' };
      REGISTRY.lessons[row.topic] = les;
    }
    if (!les.periods) les.periods = {};
    if (!les.periods[period]) les.periods[period] = {};
    var p = les.periods[period];
    if (row.schoology_folder_id) {
      p.schoologyFolder = 'https://lynnschools.schoology.com/course/' + courseId + '/materials?f=' + row.schoology_folder_id;
    }
    p.posted = row.status === 'posted' || row.status === 'taught';
    p.syncStatus = row.status;
    p.syncSource = 'supabase';
  }

  // Phase 3: recompute status using the same rule as build-roadmap-data.mjs:56
  // ready = 4 URLs AND at least one period posted
  // partial = some URLs OR any period posted
  // pending = nothing
  for (var topic in REGISTRY.lessons) {
    var les = REGISTRY.lessons[topic];
    if (!les.urls) continue;
    var urlCount = [les.urls.worksheet, les.urls.drills, les.urls.quiz, les.urls.blooket]
      .filter(Boolean).length;
    var anyPosted = false;
    if (les.periods) {
      for (var pr in les.periods) {
        if (les.periods[pr].posted) { anyPosted = true; break; }
      }
    }
    if (urlCount === 4 && anyPosted) les.status = 'ready';
    else if (urlCount > 0 || anyPosted) les.status = 'partial';
    // else keep existing status (pending or whatever was baked)
  }
}
```

Key change from v1: both phases create missing lesson shells with `{ topic, urls: {}, periods: {}, status: 'pending' }` instead of skipping unknown topics with `continue`.

### Defensive fix: `loadRegistry()` merge-not-replace

Independent of the Supabase URL work, `loadRegistry()` must stop replacing the baked registry:

```js
async function loadRegistry() {
  try {
    var resp = await fetch('roadmap-data.json', { cache: 'no-cache' });
    if (resp.ok) {
      var fresh = await resp.json();
      if (fresh && fresh.lessons) {
        if (!REGISTRY.lessons) REGISTRY.lessons = {};
        for (var k in fresh.lessons) {
          var existing = REGISTRY.lessons[k];
          var incoming = fresh.lessons[k];
          if (!existing) {
            // New topic not in baked data — accept it wholesale
            REGISTRY.lessons[k] = incoming;
          } else {
            // Per-field merge: incoming updates existing, but does not erase fields it lacks
            if (incoming.topic) existing.topic = incoming.topic;
            if (incoming.status) existing.status = incoming.status;
            if (incoming.urls) {
              if (!existing.urls) existing.urls = {};
              for (var u in incoming.urls) {
                if (incoming.urls[u] != null) existing.urls[u] = incoming.urls[u];
              }
            }
            if (incoming.periods) {
              if (!existing.periods) existing.periods = {};
              for (var p in incoming.periods) {
                if (!existing.periods[p]) existing.periods[p] = {};
                for (var f in incoming.periods[p]) {
                  if (incoming.periods[p][f] != null) existing.periods[p][f] = incoming.periods[p][f];
                }
              }
            }
          }
        }
        if (fresh.generatedAt) REGISTRY.generatedAt = fresh.generatedAt;
        if (fresh.registryVersion) REGISTRY.registryVersion = fresh.registryVersion;
      }
    }
  } catch (e) { /* use baked-in fallback */ }
  await loadSupabaseOverlay(cP);
  rCal();
  rProg();
}
```

This ensures:
- Topics missing from `roadmap-data.json` keep their baked values
- Topics present in both get a per-field merge — newer baked fields (like `schoologyFolder`) are not wiped by stale `roadmap-data.json` values
- Only non-null incoming values overwrite existing fields

## Caching Strategy

```
_supaCache = {
  urls: { rows, ts },           // topic-global, shared across periods
  sched: {
    B: { rows, ts },            // period-scoped
    E: { rows, ts },            // period-scoped
  }
}
```

- `lesson_urls` is fetched once and reused across period toggles (cache key: `urls`)
- `topic_schedule` is fetched per-period (cache key: `sched.B` / `sched.E`)
- Both expire after 60 seconds
- On period toggle, only re-fetch the schedule if the cache is stale; reuse URLs

## Files Changed

| File | Change |
|---|---|
| Supabase SQL | `CREATE TABLE lesson_urls (...)` + RLS policies |
| `scripts/lib/supabase-schedule.mjs` | Add `upsertLessonUrls()` function |
| `scripts/post-to-schoology.mjs` | Call `upsertLessonUrls()` in `syncFolderToSupabase()` |
| `scripts/sync-schedule-to-supabase.mjs` | Add `lesson_urls` backfill with drills fallback |
| `ap_stats_roadmap_square_mode.html` | Two-fetch overlay, lesson shell creation, `loadRegistry()` merge fix |

`lesson-prep.mjs` is not changed. It has no Supabase write path today and does not need one.

## Execution Order

1. Run SQL: create `lesson_urls` table + RLS policies
2. Update `supabase-schedule.mjs`: add `upsertLessonUrls()`
3. Update `post-to-schoology.mjs`: call `upsertLessonUrls()` in sync function
4. Run backfill migration: populate `lesson_urls` from registry (with drills fallback)
5. Update roadmap HTML: two-fetch overlay + lesson shells + loadRegistry merge fix
6. Commit + push + verify

## Acceptance Criteria

1. `lesson_urls` table has rows for all topics with at least one material URL
2. 7.7-7.9 have non-null `drills_url` (from per-material fallback during backfill)
3. New pipeline posting runs automatically populate `lesson_urls`
4. Roadmap page shows material icons from Supabase even when `roadmap-data.json` is stale or missing
5. Both Period B and Period E show the same material icons for the same topic
6. Topics present in `S` but missing from static registry data can render with icons once Supabase creates the lesson shell (the `S` array remains authoritative for which topics appear on the calendar grid)
7. `loadRegistry()` merges instead of replaces
8. No `build-roadmap-data.mjs` run is required after lesson ingest for the live page to be correct

## Out of Scope

- Storing AP Classroom video URLs in Supabase (from `RESOURCES` object, a different data path)
- Removing `roadmap-data.json` or `BAKED_REGISTRY` (they remain as offline fallbacks)
- Changing `build-roadmap-data.mjs` to read from Supabase
- Adding a Supabase write path to `lesson-prep.mjs`
