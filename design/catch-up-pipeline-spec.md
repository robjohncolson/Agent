# Catch-Up Pipeline — Spec

**Goal**: An idempotent, resilient orchestrator that reads the calendar through May 8th, diffs against current Schoology/registry state, builds a dependency-aware work queue, and processes it — surviving rate limits, CDP unavailability, and restarts.

**Status**: SPEC — ready for implementation

---

## Problem Statement

Today:
- `lesson-prep.mjs --auto` preps **one lesson** for **one period** (B only)
- Each run requires CDP, Gemini AI Studio, and Codex — all of which can fail
- Rate limits on AI Studio kill runs mid-flight with no recovery
- Period E gets nothing automatically
- If you miss a day, you re-run manually for each missed lesson

We need: **one command** that looks at everything from now through end-of-year, figures out what's missing, and works through it — retrying failures automatically.

---

## Design

### Architecture

```
┌──────────────────────────────────────────┐
│  catch-up.mjs (orchestrator)             │
│                                          │
│  1. Scan calendar (today → May 8)        │
│  2. Diff against registry state          │
│  3. Build/update work queue              │
│  4. Process queue (dependency-aware)     │
│  5. Park failures with retryAfter        │
└──────┬───────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────┐
│  state/work-queue.json (persistent)      │
│                                          │
│  { actions: [...], lastRun, stats }      │
└──────────────────────────────────────────┘
```

### Work Queue Shape

```json
{
  "version": 1,
  "lastRun": "2026-03-11T15:00:00Z",
  "stats": {
    "totalActions": 120,
    "completed": 45,
    "pending": 60,
    "failed": 5,
    "rateLimited": 10
  },
  "actions": [
    {
      "id": "6.8-B-ingest",
      "unit": 6,
      "lesson": 8,
      "period": "B",
      "type": "ingest",
      "status": "pending",
      "dependsOn": [],
      "attempts": 0,
      "maxAttempts": 5,
      "retryAfter": null,
      "lastError": null,
      "createdAt": "2026-03-11T15:00:00Z",
      "updatedAt": "2026-03-11T15:00:00Z",
      "completedAt": null
    }
  ]
}
```

### Action Types & Dependency Graph (per lesson per period)

```
ingest (Gemini AI Studio + CDP)
  ├──→ content-gen-worksheet (Codex)
  ├──→ content-gen-blooket (Codex)
  └──→ content-gen-drills (Codex)
         │
         └──→ render-animations (local Manim)
                │
                └──→ upload-animations (Supabase API)

content-gen-blooket ──→ upload-blooket (CDP)

[content-gen-worksheet, upload-blooket] ──→ post-schoology-{period} (CDP)

post-schoology-{period} ──→ verify-schoology-{period}
```

**Key insight**: `ingest` is the same for both periods (same video content). Content gen is also shared. Only `post-schoology` and `verify-schoology` are per-period.

Optimized graph:
```
ingest (shared)
  ├──→ content-gen-worksheet (shared)
  ├──→ content-gen-blooket (shared)
  └──→ content-gen-drills (shared)
         └──→ render-animations (shared)
                └──→ upload-animations (shared)

content-gen-blooket ──→ upload-blooket (shared)

[worksheet, upload-blooket] ──→ post-schoology-B (CDP)
[worksheet, upload-blooket] ──→ post-schoology-E (CDP)
```

So per lesson: 7 shared actions + 2 per-period posting = 9 actions.

### Action Type Definitions

| Type | Resource | Retry Strategy | Notes |
|------|----------|---------------|-------|
| `ingest` | Gemini AI Studio + CDP | `retryAfter: +4h` | Rate-limited by AI Studio web UI |
| `content-gen-worksheet` | Codex CLI | `retryAfter: +30m` | GPT 5.4, rarely fails |
| `content-gen-blooket` | Codex CLI | `retryAfter: +30m` | Same |
| `content-gen-drills` | Codex CLI | `retryAfter: +30m` | Same |
| `render-animations` | Local Manim | immediate retry | CPU-bound, no external deps |
| `upload-animations` | Supabase API | `retryAfter: +1h` | HTTP API |
| `upload-blooket` | CDP (Blooket) | `retryAfter: +1h` | Browser automation |
| `post-schoology-B` | CDP (Schoology) | `retryAfter: +1h` | Browser automation |
| `post-schoology-E` | CDP (Schoology) | `retryAfter: +1h` | Browser automation |
| `verify-schoology-B` | CDP (Schoology) | `retryAfter: +1h` | Optional final check |
| `verify-schoology-E` | CDP (Schoology) | `retryAfter: +1h` | Optional final check |

### Resource Groups

Actions share resources. Only one action per resource can run at a time:

| Resource | Actions |
|----------|---------|
| `gemini-cdp` | `ingest` |
| `codex` | `content-gen-*` (can parallel 3) |
| `schoology-cdp` | `post-schoology-*`, `upload-blooket`, `verify-schoology-*` |
| `supabase` | `upload-animations` |
| `local` | `render-animations` |

### Calendar Scanning

1. Read all `week_*_calendar.html` files from `CALENDAR_DIR`
2. Parse every day from today through May 8, 2026
3. For each day that has Period B and/or Period E entries:
   - Extract `unit.lesson` from topic tags
   - Record which periods need the lesson
4. Build the set of all `(unit, lesson)` pairs that need prep

### State Diffing

For each `(unit, lesson)` from the calendar scan:
1. Check registry entry — what's already done?
2. For each action type, check if it's complete:
   - `ingest`: `status.ingest === 'done'`
   - `content-gen-worksheet`: `status.worksheet === 'done'` + artifact exists
   - `content-gen-blooket`: `status.blooketCsv === 'done'` + artifact exists
   - `content-gen-drills`: `status.drills === 'done'` + artifact exists
   - `render-animations`: `status.animations === 'done'`
   - `upload-animations`: `status.animationUpload === 'done'`
   - `upload-blooket`: `status.blooketUpload === 'done'`
   - `post-schoology-B`: `schoology.B.folderId` exists + materials posted
   - `post-schoology-E`: `schoology.E.folderId` exists + materials posted
3. Only enqueue actions that aren't complete

### Queue Processing

```
function processQueue():
  load work-queue.json

  for each action sorted by (lesson date ASC, dependency order):
    if action.status is 'completed' or 'skipped': continue
    if action.retryAfter > now: continue (rate-limited, skip for now)
    if any dependency not 'completed': continue (blocked)

    if resource not available (e.g., CDP not running):
      skip (will retry next run)

    try:
      execute action
      mark completed
    catch rate_limit:
      mark status = 'rate-limited'
      set retryAfter = now + backoff
    catch error:
      increment attempts
      if attempts >= maxAttempts:
        mark status = 'failed'
      else:
        mark status = 'pending'
        set retryAfter = now + backoff

    save work-queue.json (after each action for crash safety)
```

### Backoff Strategy

| Failure Type | Backoff |
|-------------|---------|
| Gemini rate limit | 4 hours |
| CDP not available | 1 hour |
| Codex failure | 30 minutes |
| Supabase error | 1 hour |
| Unknown error | 2 hours |

### Idempotency

- `catch-up.mjs` can be run at any time, from any state
- It only enqueues actions that aren't already complete
- Already-queued actions with `retryAfter` in the future are skipped
- Completed actions are never re-run (unless `--force`)

---

## CLI

```bash
# Normal: scan calendar, diff, process queue
node scripts/catch-up.mjs

# Preview: show what would be queued, don't execute
node scripts/catch-up.mjs --preview

# Force re-scan even if queue exists
node scripts/catch-up.mjs --rescan

# Process only a specific lesson
node scripts/catch-up.mjs --unit 6 --lesson 8

# Clear failed actions and retry them
node scripts/catch-up.mjs --retry-failed

# Show queue status
node scripts/catch-up.mjs --status
```

---

## Implementation Plan

### Step 1: Work Queue Library (`scripts/lib/work-queue.mjs`)
- `loadQueue()`, `saveQueue()` — persistent JSON I/O
- `enqueueAction(queue, action)` — idempotent add
- `getReadyActions(queue)` — actions with all deps met and no retryAfter
- `markCompleted(queue, actionId)`
- `markFailed(queue, actionId, error, backoffMs)`
- `markRateLimited(queue, actionId, backoffMs)`
- `getStats(queue)` — summary counts

### Step 2: Calendar Scanner (`scripts/lib/calendar-scan.mjs`)
- `scanCalendar(fromDate, toDate)` — returns `[{ date, unit, lesson, periods: ['B','E'] }]`
- Reuses parsing logic from `whats-tomorrow.mjs`
- Handles multi-topic days (e.g., "6.4, 6.5")

### Step 3: State Differ (`scripts/lib/catch-up-diff.mjs`)
- `diffLessons(calendarLessons, registry)` — returns actions needed
- Builds dependency graph per lesson
- Checks artifact existence on disk
- Outputs flat action list with `dependsOn` edges

### Step 4: Queue Processor (in `catch-up.mjs`)
- Topological sort by dependencies
- Resource availability checks (CDP ping, Codex available)
- Execute each action by delegating to existing scripts
- Crash-safe: save after each action

### Step 5: Action Executors (`scripts/lib/catch-up-executors.mjs`)
- Thin wrappers around existing scripts:
  - `executeIngest(unit, lesson)` → calls `aistudio-ingest.mjs`
  - `executeContentGen(unit, lesson, type)` → calls Codex
  - `executePostSchoology(unit, lesson, period)` → calls `post-to-schoology.mjs`
  - etc.

---

## Dependency Graph (implementation steps)

```
Step 1 (work-queue lib)
  │
  ├──→ Step 2 (calendar scanner)    ── parallel
  │
  └──→ Step 5 (action executors)    ── parallel
         │
Step 3 (state differ) ← depends on Step 1 + Step 2
  │
Step 4 (catch-up.mjs orchestrator) ← depends on Steps 1-3 + Step 5
```

Steps 1, 2, and 5 are independent. Step 3 needs 1+2. Step 4 needs all.

---

## Files

```
scripts/catch-up.mjs                    # Main orchestrator CLI
scripts/lib/work-queue.mjs              # Queue library
scripts/lib/calendar-scan.mjs           # Calendar → lesson list
scripts/lib/catch-up-diff.mjs           # Registry diff → action list
scripts/lib/catch-up-executors.mjs      # Action type → script execution
state/work-queue.json                   # Persistent queue (gitignored)
design/catch-up-pipeline-spec.md        # This spec
```

---

## Constants

```
Calendar end date: 2026-05-08
Calendar dir: C:/Users/ColsonR/apstats-live-worksheet/
Queue path: state/work-queue.json
Max retry attempts: 5
Gemini backoff: 4 hours (14400000 ms)
CDP backoff: 1 hour (3600000 ms)
Codex backoff: 30 minutes (1800000 ms)
```
