# Video Pipeline Fix — Spec

## Goal

Wire video links and Blooket URLs through the entire pipeline: registry → roadmap-data → calendar HTML → Schoology. Currently, video links exist in `units.js` and the poster can handle them, but they're not populated in the registry, excluded from roadmap data, and invisible in calendar HTMLs.

## Pre-existing (no work needed)

- **Task 1 (DONE)**: `lesson-prep.mjs` already passes `--with-videos` on line 1254.
- **`loadVideoLinks()`** in `post-to-schoology.mjs:265-306` extracts AP Classroom URLs from `units.js`.
- **`--only video`** prefix match in poster already works.

## Tasks

### Task A: Extract `loadVideoLinks` to shared lib + backfill registry

**Deliverables:**
1. `scripts/lib/load-video-links.mjs` — extracted from `post-to-schoology.mjs:265-306`
2. `scripts/backfill-video-urls.mjs` — reads all topics from `units.js`, writes AP Classroom URLs to `registry[topic].urls.apVideos` (array of `{url, title}`)
3. `post-to-schoology.mjs` — replace inline `loadVideoLinks` with import from shared lib

**Files owned:** `scripts/lib/load-video-links.mjs` (new), `scripts/backfill-video-urls.mjs` (new), `scripts/post-to-schoology.mjs` (modify lines 258-306 only)

**Acceptance:**
- `node scripts/backfill-video-urls.mjs --dry-run` prints what would be written
- `node scripts/backfill-video-urls.mjs` updates registry with AP Classroom URLs
- `post-to-schoology.mjs` still works identically (import instead of inline)

### Task B: Include videos in roadmap data

**Deliverables:**
1. `build-roadmap-data.mjs` — add `videos` (AP Classroom URLs from `urls.apVideos`) to the `urls` object in output, and remove the `k !== "videos"` filter on line 88 so video posts count toward "posted" status.

**Files owned:** `scripts/build-roadmap-data.mjs`

**Acceptance:**
- `roadmap-data.json` includes `urls.videos` array for lessons that have them
- Video materials count toward `posted` status

### Task C: Batch Schoology backfill scripts

**Deliverables:**
1. `scripts/backfill-schoology-videos.mjs` — loops through registry, for each lesson with a Schoology folder but missing video materials, runs `post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --only video --no-prompt`
2. `scripts/backfill-period-e.mjs` — loops through registry, for each lesson missing `schoologyFolderE`, runs `post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798 --no-prompt`
3. Both scripts support `--dry-run` flag

**Files owned:** `scripts/backfill-schoology-videos.mjs` (new), `scripts/backfill-period-e.mjs` (new)

**Acceptance:**
- `--dry-run` prints the list of lessons that would be processed
- Without `--dry-run`, executes sequentially (CDP can only handle one at a time)
- Skips lessons that already have the target materials

### Task D: Calendar HTML link enhancement (CC-direct)

**Deliverables:**
1. `C:/Users/ColsonR/apstats-live-worksheet/calendar-linker.js` — client-side JS that fetches `roadmap-data.json`, finds each `.period-block` by its `.topic-tag` text, and appends a "Materials" row with linked badges for worksheet, drills, quiz, blooket, and videos
2. Add `<script src="calendar-linker.js"></script>` to all 9 `week_*_calendar.html` files
3. Add CSS for material link badges (`.material-link` class)

**Files owned:** All files in `C:/Users/ColsonR/apstats-live-worksheet/` (calendar HTMLs + new JS file)

**Acceptance:**
- Opening any calendar HTML in a browser shows clickable material links
- Links are color-coded by type (worksheet=blue, drills=green, quiz=orange, blooket=purple, videos=red)
- Missing materials are silently omitted (no broken links)

## Key Paths

| Path | Role |
|------|------|
| `scripts/lesson-prep.mjs` | Pipeline orchestrator (already wired) |
| `scripts/post-to-schoology.mjs` | Schoology poster (has `loadVideoLinks`) |
| `scripts/build-roadmap-data.mjs` | Roadmap data generator |
| `state/lesson-registry.json` | Master registry (46 lessons) |
| `C:/Users/ColsonR/curriculum_render/data/units.js` | AP Classroom video URL source |
| `C:/Users/ColsonR/apstats-live-worksheet/week_*_calendar.html` | Calendar HTMLs (9 files) |
| `C:/Users/ColsonR/apstats-live-worksheet/roadmap-data.json` | Generated roadmap data |

## Registry URL Schema (after backfill)

```json
"urls": {
  "worksheet": "https://...",
  "drills": "https://...",
  "quiz": "https://...",
  "blooket": "https://...",
  "schoologyFolder": "https://...",
  "schoologyFolderE": "https://...",
  "videos": ["driveId1", "driveId2"],
  "apVideos": [
    { "url": "https://apclassroom.collegeboard.org/d/...", "title": "Topic X.Y — AP Classroom Video 1" },
    { "url": "https://apclassroom.collegeboard.org/d/...", "title": "Topic X.Y — AP Classroom Video 2" }
  ]
}
```

Note: `videos` = Drive IDs (existing), `apVideos` = AP Classroom URLs (new field from backfill).
