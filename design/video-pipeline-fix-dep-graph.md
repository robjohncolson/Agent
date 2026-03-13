# Video Pipeline Fix — Dependency Graph

## Wave 1 (parallel — no dependencies)

| Agent | Task | Size | Engine | Files |
|-------|------|------|--------|-------|
| A | Extract loadVideoLinks + backfill registry | M | Codex | `scripts/lib/load-video-links.mjs`, `scripts/backfill-video-urls.mjs`, `scripts/post-to-schoology.mjs` |
| B | Include videos in roadmap data | S | Codex | `scripts/build-roadmap-data.mjs` |
| C | Batch Schoology backfill scripts | M | Codex | `scripts/backfill-schoology-videos.mjs`, `scripts/backfill-period-e.mjs` |

## Wave 2 (depends on A + B)

| Agent | Task | Size | Engine | Files |
|-------|------|------|--------|-------|
| D | Calendar HTML link enhancement | M | CC-direct | `apstats-live-worksheet/calendar-linker.js`, 9x `week_*_calendar.html` |

**Why CC-direct for D:** Works in a different repo (`apstats-live-worksheet`), needs to modify 9 HTML files + create a new JS file. Multi-file coordination across repos is not suitable for Codex.

## Wave 3 (manual, depends on A)

| Task | Action |
|------|--------|
| Run backfill-video-urls.mjs | Populate registry with AP Classroom URLs |
| Run build-roadmap-data.mjs | Rebuild roadmap with videos |
| Run backfill-schoology-videos.mjs | Post video links to Period B folders |
| Run backfill-period-e.mjs | Post all materials to Period E |

**Why manual:** Requires Edge browser with CDP on port 9222. Sequential execution.

## File Ownership (no overlaps)

```
Agent A: scripts/lib/load-video-links.mjs (create)
         scripts/backfill-video-urls.mjs (create)
         scripts/post-to-schoology.mjs (modify: lines 258-306 only)

Agent B: scripts/build-roadmap-data.mjs (modify)

Agent C: scripts/backfill-schoology-videos.mjs (create)
         scripts/backfill-period-e.mjs (create)

Agent D: C:/Users/ColsonR/apstats-live-worksheet/calendar-linker.js (create)
         C:/Users/ColsonR/apstats-live-worksheet/week_*_calendar.html (modify: add script tag)
```
