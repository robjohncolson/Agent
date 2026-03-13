# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

**Continue ingest pipeline: Unit 7 Lesson 4 and beyond.**

All infrastructure work is complete. The roadmap, registry, Schoology folders, and
deletion tools are all working. Now it's time to grind through lesson ingestion.

```bash
node scripts/lesson-prep.mjs --auto --unit 7 --lesson 4
```

### Unblocked queue actions (18 total):
- `7.3-render-animations` (animations pending for 7.3)
- `7.4-ingest` through `8.3-ingest` (10 fresh lessons to ingest)

### After each ingest batch:
1. Regenerate the sidecar: `node scripts/export-registry.mjs`
2. Rebuild roadmap data: `node scripts/build-roadmap-data.mjs`
3. Commit + push both repos (Agent + apstats-live-worksheet)

### Important: keep the sidecar in sync
The square mode roadmap (`ap_stats_roadmap_square_mode.html`) reads from
`lesson-registry-data.js` (the sidecar), NOT from `roadmap-data.json`. Both must
be regenerated after registry changes. The `build-roadmap` pipeline step handles
`roadmap-data.json` + `ap_stats_roadmap.html`, but `export-registry` handles the
sidecar. Both run after `export-registry` in the pipeline.

### Secondary: Port roadmap enhancements to square mode

`ap_stats_roadmap.html` has full registry integration (fetch+fallback, link icons,
status dots, enhanced tooltips). The square mode file already has partial registry
integration via `lookupRegistry()` + `lesson-registry-data.js`, but lacks:
- Status dots on cells
- Fetch-first with `roadmap-data.json` fallback
- The enhanced tooltip format from the other roadmap

This is lower priority — the sidecar approach works for the square mode's needs.

---

## Session Commits (2026-03-12, session 3)

### Work Done This Session

1. **Roadmap-registry integration** (dispatch: 3 agents, 2 waves):
   - Created `scripts/build-roadmap-data.mjs` — reads registry + schedule, produces
     `roadmap-data.json`, injects `BAKED_REGISTRY` into `ap_stats_roadmap.html`
   - Modified `ap_stats_roadmap.html` — fetch+fallback, link icons (📄🎯📝🟦),
     status dots (green/amber), enhanced tooltips with links + Schoology folder
   - Created `tasks/build-roadmap.json` — pipeline task def with `strategy: "skip"`
   - Wired into `pipelines/lesson-prep.json` after `export-registry`
   - Fixed double-topic status dot bug (uses worst-of across entries)
   - Commits: `0cfac7f` (Agent), `1611db4` + `cd532bf` (worksheet)

2. **Stale drill link cleanup**:
   - Probed all 4 target links via CDP — 6.4 E and 6.5 E already gone
   - Fixed `deleteSchoologyLink()` — selector `.action-links-content` → `.action-links`,
     gear click changed from `.click()` to `dispatchEvent` (jQuery delegation)
   - Deleted 6.11 B (`8286302261`) and 6.11 E (`8288287536`) successfully
   - Registry cleaned: removed stale entries, cleared `previousId` references
   - Commit: `791a2a3`

3. **Sidecar regeneration**: `lesson-registry-data.js` was stale (only had through 7.2).
   Regenerated with all 44 lessons. Square mode roadmap now shows 7.3 links.
   Commit: `cd532bf` (worksheet)

---

## Current State

### Work Queue
- **300** total actions, **111** completed, **189** pending
- **18** unblocked (7.3-render-animations, 7.4–8.3 ingest)
- Pending by unit: U7 (68), U8 (66), U9 (55)

### Registry
- **44** lessons tracked (Units 1–7), all with worksheets, **8** with Blooket
- U6: fully clean — all stale drill links removed
- 7.3: fully reconciled and posted to both periods

### deleteSchoologyLink() — NOW WORKING
- Selector fix: `.action-links` (was `.action-links-content`)
- Gear click: `dispatchEvent` with mousedown/mouseup/click sequence
- Confirmation: broadened selector for popup form buttons

---

## Key Paths

| File | Role |
|------|------|
| `scripts/lesson-prep.mjs` | Pipeline orchestrator |
| `scripts/build-roadmap-data.mjs` | Roadmap JSON + BAKED_REGISTRY injection |
| `scripts/export-registry.mjs` | Sidecar `lesson-registry-data.js` generator |
| `scripts/lib/schoology-heal.mjs` | Fixed `deleteSchoologyLink()` |
| `tasks/build-roadmap.json` | Pipeline task def (strategy: skip) |
| `state/lesson-registry.json` | Registry — 44 lessons |
| `config/topic-schedule.json` | Per-period date mappings (B + E) |
| `config/drive-video-index.json` | Drive video IDs for topics 1.1–9.6 |

## Schoology Course IDs

- Period B: `7945275782`
- Period E: `7945275798`

## Environment

- Windows 11 Education, no admin (ColsonR)
- Edge CDP port 9222 — Schoology signed in
- Node v22.19.0, Python 3.12
- `NODE_TLS_REJECT_UNAUTHORIZED=0` (corporate proxy)
- Posting uses direct form URL (not popup) — popup JS handlers broken via CDP
