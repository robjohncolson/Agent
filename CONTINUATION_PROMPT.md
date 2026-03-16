# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

**Priority 1: Continue Unit 8 ingest (8.2–8.6)**

8.1 is fully complete and verified (green on roadmap). Drive IDs are ready for 8.2–8.6.

Run per-lesson (do NOT use `--auto` — it overwrites explicit `--unit`/`--lesson` with calendar detection):

| Lesson | Drive IDs |
|--------|-----------|
| 8.2 | `1Aup8w5fYTy69zWogOdtsXCO6kl6UNCCT 1Y7lopnXRCIbckoMM9csk8h1uCixX3LKd 1FMDpI5aNP3UoB4YppkX3ba7llfvfhLba` |
| 8.3 | `1NemHYSwgnig3l3FUeyDYcDdt80aIYfd4 1A3t8-9QW7ubguCrQdApGKf4GkZWb1qBi 1tqgSvs4IHjltdUWtH7WmyqbPWGCMMoXb` |
| 8.4 | `16dgP2zYBVUN2qzFlGRXKZ5aqErJv8FyQ` |
| 8.5 | `1YHP2ipcZ5Vj35OVgZBYwExUjfU-yB2q1 1mDfMU3wJoLUEQY44eNr1d-XnwXl6aRlt` |
| 8.6 | `1DS_LxyMAABbjaN3VrMjBcDXy0PwbDaP3 1hm-K8vBzjXcx7hTdU2E8-0bIDhdUgiq_ 1v9ENpspNX7MSsuE50ZXoQyizuGOJ35sp` |

```bash
node scripts/lesson-prep.mjs --unit 8 --lesson 2 \
  --drive-ids 1Aup8w5fYTy69zWogOdtsXCO6kl6UNCCT 1Y7lopnXRCIbckoMM9csk8h1uCixX3LKd 1FMDpI5aNP3UoB4YppkX3ba7llfvfhLba
```

**New in this session:** The shared `scripts/lib/course-metadata.mjs` module now handles cartridge maps, quiz URLs (X.1 → `?u={unit-1}&l=PC`), drills resolution, and link titles. Adding unit 9 later only requires editing one file.

### Post-pipeline checklist (per lesson)

Pipeline auto-commits+pushes all 3 repos. Manual steps only if pipeline steps fail:

1. Run pipeline command above
2. If Schoology step fails, post manually:
   - Period B: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --no-prompt`
   - Period E: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798 --no-prompt --create-folder "Topic U.L"`
3. Render animations: `cd C:/Users/ColsonR/lrsl-driller && python render_batch.py --lesson NN`
4. Upload animations: `node scripts/batch-upload-animations.mjs`
5. **No `build-roadmap-data.mjs` needed** — removed from pipeline. Poster writes to Supabase live.

**Priority 2 (manual): Clean up duplicate Schoology links in 8.1 folders**

Both periods have duplicate worksheet and blooket links from re-posts during the fix-up session. Delete the extras in the Schoology UI:
- Period B: `work-ahead/future > Week 28 > Monday 4/6/26`
- Period E: `work-ahead/future > Week 28 > Friday 4/10/26`

---

## What just happened (2026-03-15/16, session 3)

### 8.1 fix-ups
- Added unit 8 to CARTRIDGE_MAP in 4 upload/poster scripts
- Fixed batch-upload unit detection bug (hardcoded 6/7 → `charAt(0)`)
- Renamed cartridge mode names to `8.1a:`–`8.1e:` convention
- Set drills URL, quiz URL (`?u=7&l=PC`), fixed animationUpload status
- Uploaded 5 animations to correct Supabase path (`apstats-u8-unexpected-results/`)
- Posted drills + quizzes to both Schoology periods
- Restored roadmap baked data for units 1-7 (had been wiped by partial registry rebuild)
- Fixed Supabase `topic_schedule` — restored "posted" status for 6.1–7.9

### Course metadata consolidation (refactor)
- Created `scripts/lib/course-metadata.mjs` — single source of truth for cartridge IDs, `resolveDrillsLink()` with fallback URLs, cross-unit quiz derivation, shared link titles
- Rewired 9 consumer files, removed 7 duplicate cartridge maps and 4 duplicate functions
- Removed `build-roadmap` from pipeline (now manual-only via F8 in commander)
- Added monotonic status guard to `supabase-schedule.mjs` — refuses posted→scheduled downgrades, fail-safe on lookup errors
- Regression tests for quiz URLs, titles, drills resolution, and status monotonicity

### lrsl-driller cleanup
- Registered unit 8 cartridge in `cartridges/registry.json`
- Pruned `package-lock.json` after TF.js removal (-596 lines)
- Cleaned codex prompt temps and manim logs

## Session Commits (2026-03-15/16)

**Agent:**
- `57892fa` refactor: consolidate course metadata into shared module
- `34bdf6f` fix: add quiz URL for 8.1 (7.9 review + Unit 7 progress check)
- `b037f6f` fix: add unit 8 cartridge maps, fix batch upload unit detection

**lrsl-driller:**
- `23c32ea` chore: prune package-lock.json after TF.js removal
- `6ca8140` chore: register unit 8 cartridge in registry.json
- `f978278` fix: rename unit 8 cartridge mode names to match convention

**follow-alongs:**
- `996a7d5` fix: 8.1 now ready — quiz URL added, 24 ready / 27 partial
- `e344d19` fix: restore full roadmap data for units 1-7, merge 8.1
- `6364e8e` fix: regenerate exports with 8.1 drills URL and corrected status

## Current State

- **All 3 repos**: clean, pushed
- **Agent**: `57892fa` = `origin/master`
- **lrsl-driller**: `23c32ea` = `origin/main`
- **follow-alongs**: `996a7d5` = `origin/master`
- **Registry**: 1 lesson (8.1) — units 1-7 data in Supabase + baked roadmap, not local registry
- **Queue**: 300 total, 111 completed, 189 pending (units 7-9)
- **Roadmap**: 24 ready (green), 27 partial (yellow) across 51 lessons. 8.1 is green.
- **Schoology**: 8.1 posted to both periods (B + E) with worksheet, drills, quizzes, blooket, AP video
- **Supabase**: `topic_schedule` (62 rows, 6.1-7.9 + 8.1 = posted), `lesson_urls` (51 rows)
- **Tests**: `node --experimental-test-isolation=none --test scripts/test/*.test.mjs`

### Known issues
- **Duplicate Schoology links**: 8.1 folders in both periods have extra worksheet/blooket entries (manual cleanup)
- **`--auto` flag bug**: Overwrites explicit `--unit`/`--lesson` with calendar detection
- **Gemini rate limit**: ~8-10 video prompts before stalling
- **ffmpeg**: Not on PATH. Use `render_batch.py`
- **Edge CDP**: Close ALL Edge windows before launching debug instance
- **Node test runner**: Sandbox blocks default spawn; use `--experimental-test-isolation=none`

## Key Paths

- Shared metadata: `scripts/lib/course-metadata.mjs` (cartridge map, quiz URLs, drills, titles)
- Pipeline: `scripts/lesson-prep.mjs`
- Task runner: `scripts/lib/task-runner.mjs`
- Registry: `state/lesson-registry.json`
- Supabase CRUD: `scripts/lib/supabase-schedule.mjs` (monotonic status guard)
- Poster: `scripts/post-to-schoology.mjs`
- Tests: `scripts/test/course-metadata.test.mjs`, `scripts/test/supabase-status.test.mjs`
- Roadmap: `C:/Users/ColsonR/apstats-live-worksheet/ap_stats_roadmap_square_mode.html`
- Drive index: `config/drive-video-index.json`

## Environment

- Windows 11, Git Bash, Node v22.19.0
- Codex CLI v0.114.0 (`codex exec --full-auto`)
- Edge CDP: `"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:/Users/ColsonR/.edge-debug-profile" &`
- Schoology B: `7945275782`, E: `7945275798`
- Supabase: `https://hgvnytaqmuybzbotosyj.supabase.co`
- Manim CE v0.18.1, ffmpeg at `C:/Users/ColsonR/ffmpeg/bin/`
- Python: `C:/Users/ColsonR/AppData/Local/Programs/Python/Python312/python.exe`
