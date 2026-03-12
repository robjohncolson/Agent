# Roadmap ↔ Registry Integration Spec

## Goal

Make `ap_stats_roadmap.html` aware of registry/Schoology state so each day cell
can show clickable links (worksheet, drills, quiz, Blooket) and deployment status.

## Architecture

```
lesson-registry.json ──┐
                        ├──▶ build-roadmap-data.mjs ──▶ roadmap-data.json
topic-schedule.json  ───┘         (build step)             │
                                                           ▼
                                              ap_stats_roadmap.html
                                                 ┌─────────────────┐
                                                 │ 1. fetch() JSON  │
                                                 │ 2. fallback to   │
                                                 │    baked-in data │
                                                 └─────────────────┘
```

### Data Flow

1. **Build step** (`scripts/build-roadmap-data.mjs`): Reads `lesson-registry.json`
   and `config/topic-schedule.json`, produces `roadmap-data.json`.
2. **Deploy**: `roadmap-data.json` is committed to `apstats-live-worksheet` repo
   alongside the roadmap HTML (served from GitHub Pages).
3. **Runtime**: Roadmap fetches `roadmap-data.json` relative to itself. On success,
   merges into SCHEDULE. On failure (offline/404), falls back to last baked-in
   snapshot embedded as `const BAKED_REGISTRY = {...}` in the HTML.

### Why Both?

- **Fetch-first**: Registry changes (new lessons posted, links updated) appear
  without rebuilding the HTML. Just re-run the build script and push the JSON.
- **Baked-in fallback**: Students on school wifi with spotty connectivity still
  see links. The baked-in data is refreshed each time the build step runs.

## JSON Schema: `roadmap-data.json`

```jsonc
{
  "generatedAt": "2026-03-12T21:00:00Z",
  "registryVersion": "sha256-first12chars",  // content hash of lesson-registry.json
  "lessons": {
    "6.1": {
      "topic": "One-Sample z Interval",
      "urls": {
        "worksheet": "https://robjohncolson.github.io/apstats-live-worksheet/u6_lesson1_live.html",
        "drills": "https://lrsl-driller.vercel.app/platform/app.html?c=...&level=...",
        "quiz": "https://robjohncolson.github.io/curriculum_render/?u=6&l=1",
        "blooket": "https://dashboard.blooket.com/set/..."
      },
      "status": "ready",           // "ready" | "partial" | "pending"
      "periods": {
        "B": {
          "date": "2026-03-02",
          "schoologyFolder": "https://lynnschools.schoology.com/course/7945275782/materials?f=...",
          "posted": true,
          "verified": true
        },
        "E": {
          "date": "2026-03-06",
          "schoologyFolder": "https://lynnschools.schoology.com/course/7945275798/materials?f=...",
          "posted": true,
          "verified": true
        }
      }
    }
    // ... one entry per lesson
  }
}
```

### Status Derivation

| Condition | `status` |
|-----------|----------|
| All 4 URLs present + both periods posted | `"ready"` |
| Some URLs present or only one period posted | `"partial"` |
| No URLs or not in registry | `"pending"` |

## Roadmap HTML Changes

### 1. Fetch + Fallback

```javascript
// Baked in by build step — refreshed each deploy
const BAKED_REGISTRY = { /* ... */ };

let REGISTRY = BAKED_REGISTRY;

async function loadRegistry() {
  try {
    const resp = await fetch('roadmap-data.json', { cache: 'no-cache' });
    if (resp.ok) REGISTRY = await resp.json();
  } catch { /* use baked-in */ }
  renderCalendar();
  renderProgress();
}
loadRegistry();
```

### 2. Enhanced Day Cells

Currently each cell shows:
```
[date] [topic label] [topic title]
```

Enhanced cell adds clickable link icons below the topic:
```
[date] [topic label] [topic title]
[📄] [🎯] [📝] [🟦]     ← worksheet, drills, quiz, blooket
```

Icons are small, subtle, and only appear for lessons with `status !== "pending"`.
Each icon links directly to the URL. Missing URLs get no icon (not a broken link).

### 3. Enhanced Tooltip

Currently shows: date, topic, due, assigned.

Enhanced tooltip adds:
- Link list: "Worksheet · Drills · Quiz · Blooket" (each clickable)
- Status badge: "Ready ✓" / "Partial ◐" / "Pending ○"
- Schoology folder link for the active period

### 4. Status Indicators on Cells

Cells gain a subtle visual indicator:
- `ready`: small green dot (bottom-left corner)
- `partial`: small amber dot
- `pending`: no dot (default state, no clutter)

## Build Script: `scripts/build-roadmap-data.mjs`

```
node scripts/build-roadmap-data.mjs
```

**Inputs:**
- `state/lesson-registry.json`
- `config/topic-schedule.json`

**Outputs:**
- `C:/Users/ColsonR/apstats-live-worksheet/roadmap-data.json` (for GitHub Pages deploy)
- Also injects `BAKED_REGISTRY` constant into `ap_stats_roadmap.html`
  (replaces the line `const BAKED_REGISTRY = { /* ... */ };` with actual data)

**Behavior:**
1. Read registry, extract per-lesson: topic, urls, status derivation
2. Read topic-schedule, merge per-period dates
3. For each lesson, compute `status` from URL presence + posting state
4. Write `roadmap-data.json`
5. Read `ap_stats_roadmap.html`, find and replace `BAKED_REGISTRY` assignment
6. Write updated HTML

**Integration with pipeline:**
- Run after any lesson-prep completes (or manually before deploy)
- Add as optional final step in `pipelines/lesson-prep.json`
- Non-blocking — failure doesn't affect lesson posting

## What Stays in the Roadmap (Not Registry)

These fields are authored in the roadmap SCHEDULE and are NOT pulled from registry:
- `due` — homework due that day ("Quiz 7.1")
- `assign` — work assigned that day ("Drills 7.3, Quiz 7.2")
- `dbl` — double topic day flag
- Day/date placement — the SCHEDULE array is the calendar of record
- OFF / EX / POST / NC constants

The registry **supplements** each day with URLs and deployment status.
The roadmap SCHEDULE remains the source of truth for what-happens-when.

## Matching Logic

The roadmap identifies each day's lesson by `d.t` (e.g., `"7.3"`).
The registry is keyed by the same format (`lessons["7.3"]`).
Matching is a direct key lookup — no fuzzy matching needed.

For double-topic days (e.g., `"6.4+6.5"`), the roadmap splits on `+` and
looks up each lesson separately, showing links for both.

## Deployment

1. Run `node scripts/build-roadmap-data.mjs`
2. `cd C:/Users/ColsonR/apstats-live-worksheet && git add roadmap-data.json ap_stats_roadmap.html && git commit && git push`
3. GitHub Pages serves updated roadmap + JSON within ~60s

## Future: Supabase Endpoint

Once the dashboard is mature, `roadmap-data.json` could be served from
Supabase (e.g., an edge function that reads registry state from the DB).
This would eliminate the build-step-for-freshness requirement. The
baked-in fallback would still provide offline resilience.

## Files to Create/Modify

| File | Action |
|------|--------|
| `scripts/build-roadmap-data.mjs` | Create — build script |
| `apstats-live-worksheet/roadmap-data.json` | Create — runtime data file |
| `apstats-live-worksheet/ap_stats_roadmap.html` | Modify — add fetch + fallback + enhanced cells |
| `pipelines/lesson-prep.json` | Modify — add optional build-roadmap step |
