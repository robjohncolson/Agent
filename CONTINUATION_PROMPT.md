# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

**Priority A: Implement pipeline smoothing fixes (spec ready, no coding done yet)**

Spec at `design/pipeline-smoothing-spec.md` — 7 fixes derived from friction in the 2026-03-13 session. These improve pipeline reliability before ingesting 7.7–7.9.

### Fixes (in wave order)

**Wave 1 (parallel, independent):**
1. **`--test-one` flag** for batch scripts — process 1 item and exit. Files: `backfill-schoology-videos.mjs`, `backfill-period-e.mjs`
2. **Dispatch threshold rule** — doc-only: tasks under 10 lines → CC-direct. Update dispatch skill docs.
3. **CDP auto-launch** — `cdp-connect.mjs` attempts to launch Edge if CDP not running. Use: `"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:/Users/ColsonR/.edge-debug-profile" &`
4. **Codex timeout increase** — default 120s → 300s in `runner/cross-agent.py`, add "exit after patch" to subagent preamble

**Wave 2 (parallel):**
5. **Post-pipeline 3-repo commit** — new script or add to `lesson-prep.mjs` final step. Repos: Agent, apstats-live-worksheet, lrsl-driller.
6. **`--skip-missing` for poster** — check worksheet file exists locally before posting URL. Default on for batch scripts.

**Wave 3 (depends on shared modules):**
7. **Auto-populate registry** — after ingest: call `loadVideoLinks()` → save `urls.apVideos`. After drills: read cartridge manifest → save `urls.drills`.

### Decision needed
Ask the user: implement these fixes first, or skip straight to ingesting 7.7?

---

**Priority B: Continue ingesting Unit 7 (7.7–7.9)**

7.6 is fully done (worksheet, drills, animations, Schoology B+E, registry complete).

### Next ingest: 7.7

```bash
node scripts/lesson-prep.mjs --unit 7 --lesson 7 \
  --drive-ids 1PVuJqbE0x35eSj5ee4c0Ewn7Ep11ijJH 1bkfmDJMIaDxbg2XTAnRfdpamFMSCFfM- 1ckZVyG_NDocb3UV6A8AZv_yyrbD8QCa0 1njeWzbSUOPWw0fZHWoYBU7uca9RbduBU
```

### Drive IDs for remaining Unit 7

| Topic | Videos | Drive IDs |
|-------|--------|-----------|
| 7.7 | 4 | `1PVuJqbE0x35eSj5ee4c0Ewn7Ep11ijJH 1bkfmDJMIaDxbg2XTAnRfdpamFMSCFfM- 1ckZVyG_NDocb3UV6A8AZv_yyrbD8QCa0 1njeWzbSUOPWw0fZHWoYBU7uca9RbduBU` |
| 7.8 | 4 | `1_R1wLiRWvyKm3BbKkvw6HtWIkn_gMrTM 1uLGTaehZ2mRh5el69Zu88SnsWfwiKwRR 1CWa1-295Bzw3xc-kKfx6xS-HT53wNJbb 1PAx6MB_d4DDsF5KHYAbxjOf7VUP0_-E5` |
| 7.9 | 6 | `1bofS5d0YSaMbYLDpBah01olGNwx_Ht4r 1329C4d76DZoxl1yQQql_T9SAeoHedObV 13QWXXAt2HXALrQouG0_3za9KwwESGq5m 1bJ-id40s9xbnD2UZp9bzfBAKxUwtOT2q 1Eb9EV7YCqrVyjGqhOw-jTbfuvmk1vHJJ 1BWoDK2CpQFkIjMsZtzrHb3VjiaJCQlw-` |

### Post-pipeline checklist (per lesson — commit ALL 3 repos!)

1. Run pipeline: `node scripts/lesson-prep.mjs --unit U --lesson L --drive-ids ...`
2. If worksheet times out, the files are likely written — check file sizes, then skip to next steps
3. Manually post if pipeline Schoology step was skipped:
   - Period B: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --no-prompt`
   - Period E: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798 --no-prompt --create-folder "Topic U.L"`
4. Render animations: `cd lrsl-driller && python render_batch.py --lesson NN`
5. Upload animations: `node scripts/batch-upload-animations.mjs`
6. Fix registry gaps: ensure `urls.drills` and `urls.apVideos` are populated
7. Rebuild roadmap: `node scripts/build-roadmap-data.mjs`
8. **Commit + push ALL 3 repos**: Agent, apstats-live-worksheet, lrsl-driller

### Known issues

- **Codex worksheet timeout**: Files are written but Codex doesn't exit. Check file sizes — if >50KB it's done. Re-run individually if needed: `node scripts/workers/codex-content-gen.mjs --task worksheet --unit U --lesson L`
- **Blooket auto-upload**: ETIMEDOUT — upload CSVs manually at dashboard.blooket.com
- **ffmpeg**: Not on system PATH. Use `render_batch.py` which sets `config.ffmpeg_executable`. Path: `C:/Users/ColsonR/ffmpeg/bin/`
- **Registry clobber bug**: Ingest step can overwrite registry. Verify size after pipeline runs.
- **Edge CDP**: Close ALL Edge windows before launching debug instance. Use direct path, not `cmd.exe /c start`.

## Session Commits (2026-03-13)

Agent:
```
bf02206 fix: 7.6 drills URL + apVideos, 7.5 drills URL backfill
b8a5422 feat: Topic 7.6 ingested + posted to Schoology B+E
71b9ea6 feat: semester folder org + phantom worksheet cleanup
4cb880b fix: backfill scripts pass folder URL/create-folder + registry updated with videos + Period E
95242fc feat: video pipeline fix — wire videos through registry, roadmap, calendar, Schoology
```

lrsl-driller:
```
679d312 feat: Topic 7.6 drills — 5 levels + Manim animations for CI diff two means
```

apstats-live-worksheet:
```
ce96abc fix: rebuild roadmap — 7.6 ready with drills + videos
49f9167 feat: Topic 7.6 — worksheet, grading, roadmap update
49fe6fc feat: add calendar-linker.js — auto-inject material links from roadmap-data.json
```

### New scripts created this session
- `scripts/lib/load-video-links.mjs` — shared AP Classroom video URL extractor
- `scripts/backfill-video-urls.mjs` — populate `registry.urls.apVideos` from units.js
- `scripts/backfill-schoology-videos.mjs` — batch post videos to Period B folders
- `scripts/backfill-period-e.mjs` — batch post all materials to Period E
- `scripts/move-to-semester-folder.mjs` — batch move folders into S1/S2 on Schoology
- `scripts/cleanup-phantom-worksheets.mjs` — remove worksheet links for non-existent files
- `apstats-live-worksheet/calendar-linker.js` — client-side material link injection

## Current State

- **Registry**: 47 lessons (units 1–7), 7.6 fully complete with status "ready"
- **Queue**: 300 total, 111 completed, 189 pending
- **Schoology B**: 47 lessons with folders, all have videos
- **Schoology E**: 47 lessons with folders (S1: units 1–4, S2: units 4.9–5.8, root: 6+)
- **Phantom worksheets**: Cleaned from registry, still on Schoology inside S1/S2 (harmless)
- **Calendar linker**: Live on GitHub Pages, auto-injects material links from roadmap-data.json
- **Animations**: 131 total uploaded to Supabase (including 5 for 7.6)
- **Spec ready**: `design/pipeline-smoothing-spec.md` — 7 fixes, not yet implemented

## Key Paths

- Pipeline: `scripts/lesson-prep.mjs`
- Registry: `state/lesson-registry.json`
- Work queue: `state/work-queue.json`
- Drive index: `config/drive-video-index.json`
- Video source: `C:/Users/ColsonR/curriculum_render/data/units.js`
- Shared video loader: `scripts/lib/load-video-links.mjs`
- Poster: `scripts/post-to-schoology.mjs`
- Roadmap builder: `scripts/build-roadmap-data.mjs`
- Calendar linker: `C:/Users/ColsonR/apstats-live-worksheet/calendar-linker.js`
- U7 cartridge: `C:/Users/ColsonR/lrsl-driller/cartridges/apstats-u7-mean-ci/`
- Smoothing spec: `design/pipeline-smoothing-spec.md`

## Environment

- Windows 11, Git Bash, Node v22.19.0
- Codex CLI v0.106.0 (`codex exec --full-auto`)
- Edge CDP: `"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:/Users/ColsonR/.edge-debug-profile" &`
- Schoology B: `7945275782`, E: `7945275798`
- Manim CE v0.18.1, ffmpeg at `C:/Users/ColsonR/ffmpeg/bin/`
- Python: `C:/Users/ColsonR/AppData/Local/Programs/Python/Python312/python.exe`
