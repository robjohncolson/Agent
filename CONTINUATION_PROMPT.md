# Agent Repo - Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

Both 9.4 and 9.5 have completed ingest, worksheet, blooket, and drills. The remaining pipeline steps for both are:

1. **Animations** — Write 4 manim scenes each for 9.4 and 9.5
2. **Blooket Upload** — `node scripts/upload-blooket.mjs --unit 9 --lesson 4` then `--lesson 5`
3. **Schoology Posting** — Both periods for both lessons
4. **Registry** — Update `state/lesson-registry.json` with drills deep link URLs for 9.4 and 9.5
5. **Supabase Sync** — `node scripts/sync-schedule-to-supabase.mjs --execute`
6. **Commit & Push** — Both repos

### 9.4 Drills cartridge
- `apstats-u9-setting-up-slope-tests` — 4 modes (state H0, choose Ha, identify t-test, check conditions)
- Created by Codex; registered in registry.json

### 9.5 Drills cartridge
- `apstats-u9-carrying-out-slope-tests` — 5 modes (calculate test statistic, set up p-value, interpret p-value, state conclusion, compare evidence strength)
- Created by Codex; registered in registry.json

### 9.5 Worksheet note
- The Codex-generated 9.5 worksheet (`u9_lesson5_live.html`) and grading file (`ai-grading-prompts-u9-l5.js`) should be spot-checked for accuracy before use.

Do not use `--auto`. It still overwrites explicit `--unit` / `--lesson` values with calendar detection.

When passing multiple drive IDs, do NOT quote them as a single string. Pass them as separate space-separated arguments after `--drive-ids`.

## Side Task: Algebra 2 Polynomial Division Blooket

A 30-card Blooket CSV for polynomial division drills was created at:
`school/algebra2/a2t3l4/blooket_polynomial_division_drills.csv`

Covers: coefficient extraction (with 0-placeholders), finding *a* from the divisor (sign-flip drill), naked signed arithmetic (multiply/add), writing the top row, and reading the bottom row (quotient + remainder + factor check). Ready to import into Blooket — has not been uploaded yet.

## Unit 8 Status — COMPLETE

All 6 lessons fully shipped: ingest, worksheet, blooket, drills, animations, Schoology (both periods).

- Cartridge: `apstats-u8-unexpected-results` — 26 levels (l01-l26)
- All animations rendered and uploaded to Supabase
- Minor loose ends:
  - 8.6 video 3 ingest missing (Gemini timeout) — not critical
  - 8.6 Period B missing AP Classroom Video 3 link (Schoology timeout)
  - Drills deep links in Schoology were manually updated for 8.3-8.6

## Unit 9 Status

| Lesson | Topic | Status | Drive IDs |
|--------|-------|--------|-----------|
| 9.1 | Do Those Points Align? | full | `1aMPs1uK5H7dvYoVaGh2TQLkdJGBAjoPd` |
| 9.2 | Confidence Intervals for Slope | full | `18e3wAS58P1SW1ok8tv3mtFPhmM3pCRwN 1LLyG6B71f0kAoo6QHxQPb1JGQ4hVwkKq 1UkOJyY-qEovCHQANK5jtZhzNNpa4iHbK` |
| 9.3 | Justifying a Claim About Slope | full | `1yWqjcF-IyHImRwTBV3cEIt13u0infZzI 1GqvcUy_AJRnTgDORWQkAVHSWjKpRxTaT` |
| 9.4 | Setting Up a Test for Slope | ingest+worksheet+blooket+drills done; needs animations, Schoology, upload | `1LKHmLObjf3Nnszvk833XeLgH5JJ9F0_g 1EBPBsC-oJXGaxn7jp1Q92IWetvaPNl1M` |
| 9.5 | Carrying Out a Test for Slope | ingest+worksheet+blooket+drills done; needs animations, Schoology, upload | `1aggJHSL5dJcEBYuo4Z7M_lvsoLvx4RYY 1vct7foAM_sxXzRy4rviUox0DkQMm7Yf- 1h5OJH_mC6MUqmKbW_K-Xqx7IN3bjOscz` |

- Cartridge: `apstats-u9-regression-slopes` — 8 levels (9.1-9.2)
- Cartridge: `apstats-u9-justify-slope-claims-ci` — 4 modes (9.3)
- Cartridge: `apstats-u9-setting-up-slope-tests` — 4 modes (9.4)
- Cartridge: `apstats-u9-carrying-out-slope-tests` — 5 modes (9.5)

## Established Workflow

Each lesson follows this pipeline:

1. **Ingest** — `node scripts/lesson-prep.mjs --unit U --lesson L --drive-ids ID1 ID2 ...`
   - Gemini rate limit is ~5 prompts per session. 3-video lessons may stall on video 3.
   - If stalled, retry in a fresh session — the script skips already-saved files.
   - Pipeline auto-runs worksheet + blooket generation after ingest.
   - Drills step always fails (Codex timeout) — build manually.

2. **Drills** — Add levels to the existing cartridge manually:
   - Read ingest slides to understand the topic
   - Add scenario banks + generator functions to `generator.js`
   - Add grading rules to `grading-rules.js`
   - Add modes, skills, progression tiers to `manifest.json`
   - Use an Agent to parallelize this work

3. **Animations** — Write 4 manim scenes per lesson:
   - CRITICAL: Do NOT use `MathTex` or `Tex` — LaTeX is not installed. Use `Text()` with Unicode.
   - Do NOT use `arrange_in_grid` with mismatched counts or `set_width(stretch=False)`
   - Render with the inline Python wrapper (ffmpeg at `C:/Users/rober/scoop/shims/ffmpeg`)
   - Upload via `node scripts/upload-animations.mjs --unit U --lesson L --cartridge CARTRIDGE_ID`
   - Update manifest animation fields after upload

4. **Blooket Upload** — `node scripts/upload-blooket.mjs --unit U --lesson L` (requires CDP/Edge)

5. **Schoology Posting** — Both periods:
   - Period B: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --no-prompt`
   - Period E: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798 --no-prompt --create-folder "Topic U.L"`
   - Requires Edge debug instance with Schoology login

6. **Registry** — Update `state/lesson-registry.json` with drills deep link URL
   - Format: `?c=CARTRIDGE_ID&level=FIRST_LEVEL_ID`
   - The poster doesn't resolve deep links from the manifest on this machine (wrong CARTRIDGES_DIR)
   - Registry fallback was added but only works if the URL is already saved with `&level=`

7. **Supabase Sync** — `node scripts/sync-schedule-to-supabase.mjs --execute`

8. **Commit & Push** — Both repos: `Agent` and `not-school/lrsl-driller`

## Fixes shipped this session

- `aistudio-ingest.mjs`: rate-limit false positive fix — skip check for responses >2000 chars, changed "capacity" to "server capacity"
- `course-metadata.mjs`: registry fallback for `resolveDrillsLink` when manifest not found locally
- `course-metadata.mjs`: added Unit 9 to CARTRIDGE_MAP
- `upload-animations.mjs` (lrsl-driller): added Units 8 and 9 to CARTRIDGE_MAP
- Agent `.env`: added SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

## Key paths (home machine)

- Agent repo: `C:/Users/rober/Downloads/Projects/Agent`
- lrsl-driller: `C:/Users/rober/Downloads/Projects/not-school/lrsl-driller`
- Worksheet output: `C:/Users/rober/Downloads/Projects/school/follow-alongs/`
- Ingest output: `C:/Users/rober/Downloads/Projects/school/follow-alongs/u9/`
- U8 cartridge: `not-school/lrsl-driller/cartridges/apstats-u8-unexpected-results/`
- U9 cartridge: `not-school/lrsl-driller/cartridges/apstats-u9-regression-slopes/`
- ffmpeg: `C:/Users/rober/scoop/shims/ffmpeg`
- Manim CE: v0.19.2

## Known issues

- `--auto` flag bug still exists in lesson-prep.mjs
- Gemini rate limit ~5 prompts per session; 3-video lessons often stall on video 3
- Schoology poster doesn't resolve drills deep links (CARTRIDGES_DIR points to wrong repo on this machine). Must manually update drills links in Schoology after posting.
- Close all Edge windows before launching the debug instance
- Codex drills generation sometimes times out at the 20min limit, but usually writes the files before validation fails
- Codex worksheet generation can hit Windows command-length limits on file writes; may need manual completion

## Environment

- Windows 11 (home machine)
- Node v22.19.0
- Manim CE v0.19.2
- Schoology B: `7945275782`
- Schoology E: `7945275798`
- Supabase: `https://hgvnytaqmuybzbotosyj.supabase.co`
