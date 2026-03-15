# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

**Priority 1: Fix 8.1 remaining items, then continue Unit 8 ingest (8.2–8.6)**

### 8.1 — Two items still needed

1. **Animation upload** — 5 mp4s rendered locally but upload failed because `CARTRIDGE_MAP` in `scripts/upload-animations.mjs` (line 33) and `scripts/batch-upload-animations.mjs` (line 26) has no entry for unit 8. Add:
   ```js
   "8": "apstats-u8-unexpected-results",
   ```
   Then run: `node scripts/batch-upload-animations.mjs` (or `node scripts/upload-animations.mjs --unit 8 --lesson 1`)

2. **Period E Schoology post** — Only Period B was posted. Run:
   ```bash
   node scripts/post-to-schoology.mjs --unit 8 --lesson 1 --auto-urls --with-videos \
     --course 7945275798 --no-prompt --create-folder "Topic 8.1"
   ```

### 8.2–8.6 — Drive IDs ready

Run per-lesson (do NOT use `--auto`):

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

**Important:** Do NOT use `--auto` flag — it overwrites `--unit`/`--lesson` with calendar detection.

**Priority 2 (minor): Move CALENDAR links to top of Schoology course materials**

The CALENDAR links point to the roadmap page (`ap_stats_roadmap_square_mode.html?period=B|E`). They're at the bottom of both courses — drag to top in Schoology UI.

### Post-pipeline checklist (per lesson)

Pipeline step 8 auto-commits+pushes all 3 repos. Manual steps only if pipeline steps fail:

1. Run pipeline command above
2. If Schoology step fails, post manually:
   - Period B: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --no-prompt`
   - Period E: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798 --no-prompt --create-folder "Topic U.L"`
3. Render animations: `cd C:/Users/ColsonR/lrsl-driller && python render_batch.py --lesson NN`
4. Upload animations: `node scripts/batch-upload-animations.mjs`
5. **No `build-roadmap-data.mjs` needed** — the poster now writes material URLs to Supabase `lesson_urls` automatically, and the roadmap reads them live.

---

## Session Commits (2026-03-15)

- `02f4fcd` pipeline: add U8 L1 content (Agent, worksheet `f77cda6`, lrsl-driller `7340495`)
- `6d1e8ad` feat: store material URLs in Supabase lesson_urls table
- `2ca818d` feat: Supabase roadmap merge — spec, prompts, link updater

## Current State

- **Registry**: 1 lesson key (8.1) — previous units 1–7 were in a prior registry snapshot
- **Queue**: 300 total, ~120 completed, ~180 pending
- **Schoology B**: 8.1 posted in `work-ahead/future > Week 28 > Monday 4/6/26`
- **Schoology E**: 8.1 NOT yet posted
- **Supabase**: `topic_schedule` (62 rows) + `lesson_urls` (50 rows) + `videos` bucket + `agent_events` + `agent_checkpoints`
- **Roadmap**: Live on GitHub Pages, reads from Supabase overlay
- **Animations**: 5 new mp4s rendered for 8.1, NOT uploaded to Supabase (cartridge map missing)
- **Drills cartridge**: `apstats-u8-unexpected-results` created in lrsl-driller, 5 levels

### Known issues

- **Animation upload CARTRIDGE_MAP**: Missing unit 8 entry in both `upload-animations.mjs` and `batch-upload-animations.mjs`
- **Post-pipeline reconciliation**: prints false `missing_material` warnings even when schoology-verify passes
- **`--auto` flag bug**: Overwrites explicit `--unit`/`--lesson` with calendar detection
- **Gemini rate limit**: ~8-10 video prompts before stalling
- **Codex worksheet timeout**: 15-minute limit can be tight — task-runner auto-retries
- **Blooket auto-upload**: Works via CDP now (succeeded for 8.1)
- **ffmpeg**: Not on PATH. Use `render_batch.py`
- **Edge CDP**: Close ALL Edge windows before launching debug instance

## Key Paths

- Pipeline: `scripts/lesson-prep.mjs`
- Task runner: `scripts/lib/task-runner.mjs`
- Registry: `state/lesson-registry.json`
- Supabase CRUD: `scripts/lib/supabase-schedule.mjs` (upsertTopic + upsertLessonUrls)
- Folder resolver: `scripts/lib/resolve-folder-path.mjs`
- Poster: `scripts/post-to-schoology.mjs`
- Verify: `scripts/schoology-verify.mjs`
- Migration: `scripts/sync-schedule-to-supabase.mjs` (topic_schedule + lesson_urls)
- Roadmap: `C:/Users/ColsonR/apstats-live-worksheet/ap_stats_roadmap_square_mode.html`
- Topic schedule: `config/topic-schedule.json`
- Drive index: `config/drive-video-index.json`
- Animation upload: `scripts/upload-animations.mjs` (CARTRIDGE_MAP line 33)
- Batch upload: `scripts/batch-upload-animations.mjs` (CARTRIDGE_MAP line 26)

## Environment

- Windows 11, Git Bash, Node v22.19.0
- Codex CLI v0.114.0 (`codex exec --full-auto`)
- Edge CDP: `"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --remote-debugging-port=9222 --user-data-dir="C:/Users/ColsonR/.edge-debug-profile" &`
- Schoology B: `7945275782`, E: `7945275798`
- Supabase: `https://hgvnytaqmuybzbotosyj.supabase.co`
- Manim CE v0.18.1, ffmpeg at `C:/Users/ColsonR/ffmpeg/bin/`
- Python: `C:/Users/ColsonR/AppData/Local/Programs/Python/Python312/python.exe`
