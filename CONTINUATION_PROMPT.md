# Agent Repo - Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

Two tracks of work are ready:

### Track A: Roadmap Calendar — Schedule Editor (Phase 4)

The roadmap app (`school/follow-alongs/ap_stats_roadmap_square_mode.html`) was redesigned with multi-year scheduling. Phases 1-3 are shipped and live on GitHub Pages. Phase 4 (the in-app schedule editor) is not yet built.

**What's done:**
- `SCHEDULE_DEFS` system with SY 25-26 (legacy lock) and SY 26-27 (generator-based)
- `generateSchedule()` builds S array from pacing definition + block pattern + days off
- Year selector in View menu + click-to-cycle in info bar
- Dynamic legend, progress bar, countdown adapt to active year
- System 7 window drag + minimize-to-desktop-icon
- CSS colors for Units 1-9
- Full pacing data for SY 26-27 (82 topics Period B, 54 topics Period E with double-blocks)
- `loadScheduleEdits()` / `saveScheduleEdits()` / `applyEdits()` already exist but have no UI

**Phase 4 — Schedule Editor (not yet built):**
Add a System 7.5-style editor dialog with three tabs:
1. **Days Off** — Month grid where clicking a day toggles it OFF/ON
2. **Block Pattern** — Checkboxes for which days each period meets, dropdown for double-block day
3. **Pacing** — Read-only topic list (v1)

Open from View menu → "Edit Schedule..." Edits stored in localStorage via the existing persistence functions. Only available for generated years (SY 26-27), not legacy (SY 25-26).

The plan file is at: `C:/Users/rober/.claude/plans/sharded-churning-pancake.md`

### Track B: Build Lesson Materials for Units 1-3

For SY 26-27 prep, Units 1-3 need the full pipeline (ingest through Schoology). These units have NO existing materials — no ingest, no worksheets, no blookets, no drills.

**Material audit (as of 2026-03-26):**

| Unit | Lessons | Worksheets | Blookets | Ingest | Drills | Animations |
|------|---------|-----------|----------|--------|--------|-----------|
| 1 | 10 (1.1-1.10) | 0 | 0 | 0 | 0 | 0 |
| 2 | 9 (2.1-2.9) | 0 | 0 | 0 | 0 | 0 |
| 3 | 7 (3.1-3.7) | 0 | 0 | 0 | 0 | 0 |
| 4 | 12 | 14 | 6 | yes | 0 | 0 |
| 5 | 8 | 14 | 7 | yes | 0 | 0 |
| 6 | 11 | 20 | 10 | yes | 0 | 0 |
| 7 | 9 | 18 | 9 | yes | 0 | 0 |
| 8 | 6 | 12 | 6 | yes | 4 cartridges | yes |
| 9 | 5 | 10 | 5 | yes | 5 cartridges | yes |

Units 4-7 have ingest/worksheets/blookets but need drills + animations.
Units 1-3 need everything from scratch.

**To start Unit 1 ingest**, you need AP Classroom video Drive IDs for topics 1.1-1.10. The user will need to provide these.

## Loose Ends

- Drills deep links in Schoology need manual update for 9.4 and 9.5
  - 9.4: `?c=apstats-u9-setting-up-slope-tests&level=l94-state-null-hypothesis`
  - 9.5: `?c=apstats-u9-carrying-out-slope-tests&level=l95-calculate-test-statistic`
- Codex-generated 9.5 worksheet (`u9_lesson5_live.html`) and grading file should be spot-checked
- Algebra 2 polynomial division Blooket CSV at `school/algebra2/a2t3l4/` — not yet uploaded

## Unit 8 Status — COMPLETE

All 6 lessons fully shipped. Cartridges: `apstats-u8-chi-square-setup`, `apstats-u8-expected-counts-two-way-tables`, `apstats-u8-chi-square-homogeneity-independence`, `apstats-u8-carrying-out-chi-square-tests`.

## Unit 9 Status — COMPLETE

All 5 lessons fully shipped (9.1-9.5). Cartridges:
- `apstats-u9-do-those-points-align` (9.1)
- `apstats-u9-confidence-intervals-slope` (9.2)
- `apstats-u9-justify-slope-claims-ci` (9.3)
- `apstats-u9-setting-up-slope-tests` (9.4, 4 modes)
- `apstats-u9-carrying-out-slope-tests` (9.5, 5 modes)

## Established Workflow

Each lesson follows this pipeline:

1. **Ingest** — `node scripts/lesson-prep.mjs --unit U --lesson L --drive-ids ID1 ID2 ...`
   - Gemini rate limit is ~5 prompts per session. 3-video lessons may stall on video 3.
   - If stalled, retry in a fresh session — the script skips already-saved files.
   - Pipeline auto-runs worksheet + blooket + drills generation after ingest.
   - Drills Codex sometimes times out at 20min but usually writes files before validation fails.

2. **Drills** — Codex creates new cartridges automatically via the pipeline. Validate output. If it fails, build manually:
   - Add scenario banks + generator functions to `generator.js`
   - Add grading rules to `grading-rules.js`
   - Add modes, skills, progression tiers to `manifest.json`

3. **Animations** — Write 4 manim scenes per lesson:
   - CRITICAL: Do NOT use `MathTex` or `Tex` — LaTeX is not installed. Use `Text()` with Unicode.
   - Render with `-ql` flag: `python -m manim -ql --media_dir media/videos/apstat_XY_scenes animations/apstat_XY_scenes.py SceneName`
   - Copy MP4s to `media/videos/apstat_XY_scenes/480p15/` for upload script
   - Upload: `DRILLER_DIR="C:/Users/rober/Downloads/Projects/school/lrsl-driller" node scripts/upload-animations.mjs --unit U --lesson L`

4. **Blooket Upload** — `node scripts/upload-blooket.mjs --unit U --lesson L` (requires CDP/Edge)

5. **Schoology Posting** — Both periods:
   - Period B: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --no-prompt`
   - Period E: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798 --no-prompt --create-folder "Topic U.L"`

6. **Registry** — Update `state/lesson-registry.json` with drills deep link URL

7. **Supabase Sync** — `node scripts/sync-schedule-to-supabase.mjs --execute`

8. **Commit & Push** — Repos: `Agent`, `school/follow-alongs` (apstats-live-worksheet), `not-school/lrsl-driller`

Do not use `--auto` flag. It still overwrites explicit `--unit` / `--lesson` values.

## Fixes shipped recently

- `upload-animations.mjs`: DRILLER_DIR now reads from env var (home machine: set `DRILLER_DIR` env)
- `upload-animations.mjs`: Units 8 and 9 added to CARTRIDGE_MAP
- `course-metadata.mjs`: registry fallback for `resolveDrillsLink`, Unit 9 in CARTRIDGE_MAP
- `aistudio-ingest.mjs`: rate-limit false positive fix

## Key paths (home machine)

- Agent repo: `C:/Users/rober/Downloads/Projects/Agent`
- lrsl-driller: `C:/Users/rober/Downloads/Projects/not-school/lrsl-driller`
- Follow-alongs (GitHub Pages): `C:/Users/rober/Downloads/Projects/school/follow-alongs/`
- Roadmap app: `school/follow-alongs/ap_stats_roadmap_square_mode.html`
- Ingest output: `school/follow-alongs/u{N}/`
- U9 cartridges: `not-school/lrsl-driller/cartridges/apstats-u9-*/`
- Animations: `not-school/lrsl-driller/animations/apstat_*_scenes.py`
- ffmpeg: `C:/Users/rober/scoop/shims/ffmpeg`
- Manim CE: v0.19.2
- Framework files (topic lists): `school/follow-alongs/apstat_{1-9}_framework.md`

## Known issues

- `--auto` flag bug still exists in lesson-prep.mjs
- Gemini rate limit ~5 prompts per session; 3-video lessons often stall on video 3
- Schoology poster doesn't resolve drills deep links (CARTRIDGES_DIR mismatch). Must manually update.
- Close all Edge windows before launching the debug instance
- Codex worksheet generation can hit Windows command-length limits; may need manual completion
- Manim `--media_dir` creates nested `videos/` subdirectories; copy MP4s to flat `480p15/` dir for upload

## Environment

- Windows 11 (home machine)
- Node v22.19.0
- Manim CE v0.19.2
- Schoology B: `7945275782`
- Schoology E: `7945275798`
- Supabase: `https://hgvnytaqmuybzbotosyj.supabase.co`
- GitHub Pages: `robjohncolson.github.io/apstats-live-worksheet/`
