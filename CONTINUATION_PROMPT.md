# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

**Resume 7.8 ingest (partial), then 7.9**

### 7.7 — COMPLETE (committed + pushed 2026-03-14)

All content generated, posted to Schoology B + E (6/6 each), committed across all 3 repos.
Registry bookkeeping: worksheet auto-healed to "done" by artifact check. Committed flag still pending.

### 7.8 — PARTIAL (Gemini rate limit hit Sat 2026-03-14 ~10:50am)

Only Video 1 exists in `C:/Users/ColsonR/apstats-live-worksheet/u7/`:
- `apstat_7-8-1_transcription.txt` + `_slides.txt`
- Videos 2-4: NOT ingested

The task runner will still run the ingest step (since not all 8 files exist), but
`aistudio-ingest.mjs` has its own per-video skip logic (lines 931-957) that detects
existing files and skips Video 1 automatically. Only Videos 2-4 will hit Gemini.

```bash
# Resume 7.8 (will skip Video 1 automatically)
node scripts/lesson-prep.mjs --unit 7 --lesson 8 \
  --drive-ids 1_R1wLiRWvyKm3BbKkvw6HtWIkn_gMrTM 1uLGTaehZ2mRh5el69Zu88SnsWfwiKwRR 1CWa1-295Bzw3xc-kKfx6xS-HT53wNJbb 1PAx6MB_d4DDsF5KHYAbxjOf7VUP0_-E5
```

### 7.9 — NOT STARTED

```bash
# 7.9 (6 videos)
node scripts/lesson-prep.mjs --unit 7 --lesson 9 \
  --drive-ids 1bofS5d0YSaMbYLDpBah01olGNwx_Ht4r 1329C4d76DZoxl1yQQql_T9SAeoHedObV 13QWXXAt2HXALrQouG0_3za9KwwESGq5m 1bJ-id40s9xbnD2UZp9bzfBAKxUwtOT2q 1Eb9EV7YCqrVyjGqhOw-jTbfuvmk1vHJJ 1BWoDK2CpQFkIjMsZtzrHb3VjiaJCQlw-
```

**Important:** Do NOT use `--auto` flag — it overwrites `--unit`/`--lesson` with calendar detection, which fails on weekends/holidays.

### Post-pipeline checklist (per lesson)

Pipeline step 8 auto-commits+pushes all 3 repos. Manual steps only if pipeline steps fail:

1. Run pipeline command above
2. If Codex worksheet times out: task-runner artifact check auto-skips the step if HTML exists on disk. No manual flags needed.
   Note: two skip layers exist — task-runner checks whole-step artifacts, aistudio-ingest.mjs checks per-video files.
3. If Schoology step fails, post manually:
   - Period B: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --no-prompt`
   - Period E: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798 --no-prompt --create-folder "Topic U.L"`
4. Render animations: `cd C:/Users/ColsonR/lrsl-driller && python render_batch.py --lesson NN`
5. Upload animations: `node scripts/batch-upload-animations.mjs`
6. Rebuild roadmap: `node scripts/build-roadmap-data.mjs`

### After all three are done

Begin Unit 8 ingest. Drive IDs for 8.1–8.6 are in `config/drive-video-index.json`.

---

## Session Commits (2026-03-14)

```
ea71ee1 feat: artifact-based skip + 7.7 ingested and posted to Schoology B+E
7ba571e feat: pipeline smoothing — 7 fixes for lesson-prep reliability
```

apstats-live-worksheet:
```
79b908b feat: Topic 7.7 worksheet + blooket + ingest, 7.8 Video 1 partial
```

lrsl-driller:
```
a525b17 feat: Topic 7.7 drills + animations added to u7 cartridge
```

Prior session (2026-03-13):
```
199722b handoff: 7.6 done, pipeline smoothing spec ready, next 7.7-7.9
bf02206 fix: 7.6 drills URL + apVideos, 7.5 drills URL backfill
b8a5422 feat: Topic 7.6 ingested + posted to Schoology B+E
```

## Current State

- **Registry**: 49 lesson keys (units 1–7, includes 7.8 stub), 7.7 operationally done, 7.8 partial, 7.9 not started
- **Queue**: 300 total, stale (7.7-ingest still shows pending — needs reconciliation)
- **Schoology B**: 48 lessons with folders + videos (7.7 in work-ahead/future/Week 27)
- **Schoology E**: 48 lessons with folders (7.7 in work-ahead/future/Week 28)
- **Artifact-based skip**: LIVE in `task-runner.mjs` — checks disk files before re-running whole steps
- **Animations**: 131 uploaded to Supabase. 7.7 has 5 Manim scripts + 3 partial render trees locally (no final mp4s, registry says "failed")

### Known issues

- **`--auto` flag bug**: Overwrites explicit `--unit`/`--lesson` with calendar detection. Don't use on weekends.
- **Gemini rate limit**: ~8-10 video prompts before stalling. Space out lessons.
- **Codex worksheet timeout**: Files written but Codex doesn't exit. Task-runner artifact check auto-skips entire step on retry if HTML >10KB exists.
- **Blooket auto-upload**: ETIMEDOUT — upload CSVs manually at dashboard.blooket.com
- **ffmpeg**: Not on PATH. Use `render_batch.py` (sets `config.ffmpeg_executable`)
- **Edge CDP**: Close ALL Edge windows before launching debug instance

## Key Paths

- Pipeline: `scripts/lesson-prep.mjs`
- Task runner: `scripts/lib/task-runner.mjs` (artifact check at line ~155)
- Registry: `state/lesson-registry.json`
- Work queue: `state/work-queue.json`
- Drive index: `config/drive-video-index.json`
- Poster: `scripts/post-to-schoology.mjs`
- U7 cartridge: `C:/Users/ColsonR/lrsl-driller/cartridges/apstats-u7-mean-ci/`

## Environment

- Windows 11, Git Bash, Node v22.19.0
- Codex CLI v0.106.0 (`codex exec --full-auto`)
- Edge CDP: `"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:/Users/ColsonR/.edge-debug-profile" &`
- Schoology B: `7945275782`, E: `7945275798`
- Manim CE v0.18.1, ffmpeg at `C:/Users/ColsonR/ffmpeg/bin/`
- Python: `C:/Users/ColsonR/AppData/Local/Programs/Python/Python312/python.exe`
