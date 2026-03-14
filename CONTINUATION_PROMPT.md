# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

**Resume 7.7 ingest (partial), then 7.8 and 7.9**

### 7.7 — PARTIAL INGEST (Gemini rate limit hit Fri 2026-03-13 ~11:20pm)

7/8 ingest files saved. Missing only `apstat_7-7-4_slides.txt`.
All other files exist in `C:/Users/ColsonR/apstats-live-worksheet/u7/`:
- `apstat_7-7-1_transcription.txt` + `_slides.txt`
- `apstat_7-7-2_transcription.txt` + `_slides.txt`
- `apstat_7-7-3_transcription.txt` + `_slides.txt`
- `apstat_7-7-4_transcription.txt` (slides MISSING)

**To finish 7.7:**
1. Re-run ingest for just Video 4 slides, OR manually get slides from AI Studio
2. Then run pipeline with `--skip-ingest`:
   ```bash
   node scripts/lesson-prep.mjs --unit 7 --lesson 7 --skip-ingest
   ```

**Important:** Do NOT use `--auto` flag — it overwrites `--unit`/`--lesson` with calendar detection, which fails on weekends/holidays. Always use explicit `--unit N --lesson N`.

### 7.8 and 7.9 — NOT STARTED

```bash
# 7.8 (4 videos)
node scripts/lesson-prep.mjs --unit 7 --lesson 8 \
  --drive-ids 1_R1wLiRWvyKm3BbKkvw6HtWIkn_gMrTM 1uLGTaehZ2mRh5el69Zu88SnsWfwiKwRR 1CWa1-295Bzw3xc-kKfx6xS-HT53wNJbb 1PAx6MB_d4DDsF5KHYAbxjOf7VUP0_-E5

# 7.9 (6 videos)
node scripts/lesson-prep.mjs --unit 7 --lesson 9 \
  --drive-ids 1bofS5d0YSaMbYLDpBah01olGNwx_Ht4r 1329C4d76DZoxl1yQQql_T9SAeoHedObV 13QWXXAt2HXALrQouG0_3za9KwwESGq5m 1bJ-id40s9xbnD2UZp9bzfBAKxUwtOT2q 1Eb9EV7YCqrVyjGqhOw-jTbfuvmk1vHJJ 1BWoDK2CpQFkIjMsZtzrHb3VjiaJCQlw-
```

### Drive video index note
`config/drive-video-index.json` has fewer IDs than the continuation prompt commands (indexed Mar 6).
The explicit `--drive-ids` flags bypass the index, so this won't block ingestion.

### Post-pipeline checklist (per lesson)

Pipeline step 8 now auto-commits+pushes all 3 repos. Manual steps only needed if pipeline steps fail:

1. Run pipeline command above
2. If worksheet Codex times out: check file size (`>50KB` = done), then re-run with `--skip-ingest`
3. If Schoology step fails, post manually:
   - Period B: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --no-prompt`
   - Period E: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798 --no-prompt --create-folder "Topic U.L"`
4. Render animations: `cd C:/Users/ColsonR/lrsl-driller && python render_batch.py --lesson NN`
5. Upload animations: `node scripts/batch-upload-animations.mjs`
6. Rebuild roadmap: `node scripts/build-roadmap-data.mjs`
7. Verify: `urls.drills` and `urls.apVideos` should now auto-populate (Fix 5a/5b)

### After all three are done

Begin Unit 8 ingest. Drive IDs for 8.1–8.6 are in `config/drive-video-index.json`.

---

## Session Commits (2026-03-14)

```
7ba571e feat: pipeline smoothing — 7 fixes for lesson-prep reliability
(no new commits this session — rate-limited before pipeline completed)
```

Prior session (2026-03-13):
```
199722b handoff: 7.6 done, pipeline smoothing spec ready, next 7.7-7.9
bf02206 fix: 7.6 drills URL + apVideos, 7.5 drills URL backfill
b8a5422 feat: Topic 7.6 ingested + posted to Schoology B+E
```

## Current State

- **Registry**: 47 lessons (units 1–7), 7.6 complete, 7.7–7.9 not yet ingested
- **Queue**: 300 total, 111 completed, 189 pending, 18 unblocked (7.3–8.3 ingest actions)
- **Schoology B**: 47 lessons with folders + videos
- **Schoology E**: 47 lessons with folders (S1: units 1–4, S2: 4.9–5.8, root: 6+)
- **Pipeline smoothing**: ALL 7 FIXES COMPLETE (`design/pipeline-smoothing-spec.md`)
- **Animations**: 131 uploaded to Supabase

### Known issues

- **`--auto` flag bug**: Overwrites explicit `--unit`/`--lesson` with calendar detection. Don't use on weekends. Use explicit args instead.
- **Gemini rate limit**: Hit ~11:20pm on 4th video. Space out ingest runs or wait between lessons.
- **Codex worksheet timeout**: Files written but Codex doesn't exit. Check sizes, re-run with `--skip-ingest`
- **Blooket auto-upload**: ETIMEDOUT — upload CSVs manually at dashboard.blooket.com
- **ffmpeg**: Not on PATH. Use `render_batch.py` (sets `config.ffmpeg_executable`)
- **Edge CDP**: Close ALL Edge windows before launching debug instance

## Key Paths

- Pipeline: `scripts/lesson-prep.mjs`
- Registry: `state/lesson-registry.json`
- Work queue: `state/work-queue.json`
- Drive index: `config/drive-video-index.json`
- Video source: `C:/Users/ColsonR/curriculum_render/data/units.js`
- Poster: `scripts/post-to-schoology.mjs`
- Post-pipeline commit: `scripts/post-pipeline-commit.mjs`
- Roadmap builder: `scripts/build-roadmap-data.mjs`
- U7 cartridge: `C:/Users/ColsonR/lrsl-driller/cartridges/apstats-u7-mean-ci/`

## Environment

- Windows 11, Git Bash, Node v22.19.0
- Codex CLI v0.106.0 (`codex exec --full-auto`)
- Edge CDP: `"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:/Users/ColsonR/.edge-debug-profile" &`
- Schoology B: `7945275782`, E: `7945275798`
- Manim CE v0.18.1, ffmpeg at `C:/Users/ColsonR/ffmpeg/bin/`
- Python: `C:/Users/ColsonR/AppData/Local/Programs/Python/Python312/python.exe`
