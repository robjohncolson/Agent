# Lesson Prep Workflow Spec

**Author**: Agent (observed 2026-03-04, Topic 6.4)
**Observation**: #44 in `observations/log.json`

---

## Overview

A repeatable 12-step pipeline that produces all student-facing materials for one AP Statistics lesson. The pipeline touches 3 repos, 2 LLMs, and 4 external platforms. It currently runs ~45-60 minutes by hand with significant manual relay work.

## Inputs

| Input | Source | Format |
|-------|--------|--------|
| Unit + Lesson number | Calendar HTML | e.g. `u=6, l=4` |
| AP Classroom video(s) | Screen recording → Google Drive | `.mp4` / `.webm`, 1-3 per lesson |
| Prior video context files (optional) | `apstats-live-worksheet/u{N}/` | Already done for earlier lessons in same unit |

## Outputs (per lesson)

| Artifact | Repo | Destination |
|----------|------|-------------|
| Live worksheet HTML | `apstats-live-worksheet` | GitHub Pages → Schoology link |
| AI grading prompts JS | `apstats-live-worksheet` | Used by worksheet at runtime |
| Blooket CSV | `apstats-live-worksheet` | Uploaded to blooket.com → Schoology link |
| 4 video context files | `apstats-live-worksheet/u{N}/` | Consumed by CC during generation |
| Cartridge extension (manifest, generator, grading) | `lrsl-driller` | Auto-deployed via Vercel → Schoology link |
| Manim animation .py files (3-7 per lesson) | `lrsl-driller/animations/` | Rendered to MP4 → Supabase bucket |
| Rendered MP4 animations | Supabase storage | Referenced by cartridge manifest |
| Quiz URL | `curriculum-render` | Already deployed on GitHub Pages → Schoology link |

## The 12 Steps

### Phase A: Content Extraction (Gemini)

#### Step 1 — Check calendar
- **Action**: Open `week_*_calendar.html` in browser, identify tomorrow's topic
- **Tool**: Browser
- **Time**: ~1 min
- **Friction**: Low — must find the right calendar file by week

#### Step 2 — Screen-record AP Classroom videos
- **Action**: Record screen while playing AP Classroom topic videos. Upload to Google Drive. Rename files for clarity (e.g. `6-4a.mp4`, `6-4b.mp4`)
- **Tool**: Screen recorder + Google Drive
- **Time**: ~10-15 min (depends on video length, typically 5-10 min per video)
- **Friction**: Medium — manual but unavoidable (AP Classroom doesn't allow direct download)

#### Step 3 — Transcribe + describe slides (Gemini)
- **Action**: Open aistudio.google.com. For each video (typically 2):
  - Upload video, prompt: "Transcribe with timestamps"
  - Same video, prompt: "Describe each slide with timestamps"
  - Copy each output as markdown
- **Tool**: Gemini 3.1 Pro via AI Studio (free web UI)
- **Time**: ~8-12 min (2 min per prompt × 4 prompts, plus upload/copy time)
- **Friction**: HIGH — 4 repetitive manual prompts with copy-paste. Same two prompts every time.
- **Output**: 4 text blocks (2 transcripts + 2 slide descriptions)

#### Step 4 — Save video context files
- **Action**: Save the 4 outputs to `apstats-live-worksheet/u{N}/` as:
  - `apstat_{U}-{L}-{V}_transcription.txt`
  - `apstat_{U}-{L}-{V}_slides.txt`
- **Tool**: Text editor / file save
- **Time**: ~2 min
- **Friction**: Medium — manual file creation, naming convention must be correct

### Phase B: Content Generation (Claude Code)

#### Step 5 — Generate worksheet + grading + Blooket (CC Session #1)
- **Action**: Launch Claude Code in `apstats-live-worksheet` repo. Prompt to generate:
  - `u{U}_lesson{L}_live.html` — follow-along worksheet (~1200-1400 lines)
  - `ai-grading-prompts-u{U}-l{L}.js` — AI grading rubrics (~150-200 lines)
  - `u{U}_l{L}_blooket.csv` — Blooket quiz (~35-42 questions)
- **Tool**: Claude Code (`--dangerously-skip-permissions`)
- **Time**: ~5-8 min (CC generates all three in one session)
- **Friction**: Low — one prompt, CC reads the video context files and does the rest
- **Inputs consumed**: Video context files from Step 4, existing worksheets as pattern reference

#### Step 6 — Extend cartridge + generate Manim animations (CC Session #2)
- **Action**: Launch Claude Code in `lrsl-driller` repo with Math-To-Manim skill plugin. Prompt to:
  - Write a spec for the new topic modes
  - Add modes to `cartridges/apstats-u6-inference-prop/manifest.json`
  - Extend `generator.js` with problem generation logic
  - Extend `grading-rules.js` with grading logic
  - Update `ai-grader-prompt.txt`
  - Generate 5-7 Manim `.py` animation scripts
  - Render animations to MP4
- **Tool**: Claude Code (`--plugin-dir ./Math-To-Manim/skill` + npx manim skills)
- **Time**: ~10-15 min (spec + code generation + rendering)
- **Friction**: Low — one prompt covers it all. Math-To-Manim skill handles animation generation.
- **Output**: ~2000-3000 lines of code + 5-7 MP4 files

**Note**: Steps 5 and 6 can run in parallel (separate terminal sessions).

### Phase C: Distribution

#### Step 7 — Upload Blooket CSV
- **Action**: Open blooket.com → Create Set → CSV Import → upload file → copy resulting URL
- **Tool**: Browser (blooket.com)
- **Time**: ~2-3 min
- **Friction**: Medium — manual upload, no API available

#### Step 8 — Upload animation MP4s to Supabase
- **Action**: Open Supabase dashboard → Storage → bucket → upload rendered MP4 files
- **Tool**: Browser (Supabase dashboard)
- **Time**: ~3-5 min (depends on file count/size)
- **Friction**: Medium — manual drag-and-drop upload for each file

#### Step 9 — Commit + push apstats-live-worksheet
- **Action**: `git add . && git commit && git push` — makes worksheet URL live on GitHub Pages
- **Tool**: Git CLI (in CC session or manual)
- **Time**: ~1 min
- **Friction**: Low

#### Step 10 — Commit + push lrsl-driller
- **Action**: `git add . && git commit && git push` — triggers Vercel deploy, makes drill URL live
- **Tool**: Git CLI (in CC session or manual)
- **Time**: ~1 min
- **Friction**: Low

#### Step 11 — Collect URLs
- **Action**: Gather 4 URLs for Schoology:
  1. Worksheet: `https://robjohncolson.github.io/apstats-live-worksheet/u{U}_lesson{L}_live.html`
  2. Blooket: (copied from blooket.com after upload)
  3. Drills: `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l{NN}-{mode-slug}`
  4. Quiz: `https://robjohncolson.github.io/curriculum_render/?u={U}&l={L-1}` (quiz is for previous lesson)
- **Tool**: Browser tabs / clipboard
- **Time**: ~2 min
- **Friction**: Medium — 3 of 4 URLs are predictable from unit+lesson, only Blooket varies

#### Step 12 — Post links to Schoology
- **Action**: Open Schoology → navigate to course → add 4 links as materials/assignments
- **Tool**: Browser (Schoology)
- **Time**: ~3-5 min
- **Friction**: Medium — repetitive clicking through Schoology UI for each link

---

## Timing Summary

| Phase | Steps | Time (hand) | Parallelizable |
|-------|-------|-------------|----------------|
| A. Content Extraction | 1-4 | ~20-30 min | No (sequential) |
| B. Content Generation | 5-6 | ~10-15 min | Yes (two CC sessions) |
| C. Distribution | 7-12 | ~12-17 min | Partially (uploads concurrent with pushes) |
| **Total** | **12** | **~42-62 min** | |

---

## Suggested Workflow Improvements

### 1. Video Ingest Script (HIGH priority)

**Eliminates**: Step 3 (4 manual Gemini prompts) + Step 4 (manual file save)
**Time saved**: ~10-14 min → ~2 min (one command)
**Status**: `video-ingest.mjs` already built in `apstats-live-worksheet/`

```bash
node video-ingest.mjs 6 4 "path/to/6-4a.mp4" "path/to/6-4b.mp4"
```

**Remaining work**: Adapt output naming to match convention (`apstat_{U}-{L}-{V}_{type}.txt`), test with real video files. API key is already in `.env`.

---

### 2. Supabase Upload Script (MEDIUM priority)

**Eliminates**: Step 8 (manual dashboard upload)
**Time saved**: ~3-5 min → ~30 sec
**Status**: Not started. Supabase CLI supports `supabase storage cp`.

**Implementation sketch**:
```bash
# Install: npm i -g supabase
# One-time: supabase login

# Upload all rendered MP4s for a topic
supabase storage cp ./media/videos/apstat_64_*.mp4 \
  sb://animations/apstats-u6/ \
  --project-ref <project-ref>
```

Or a Node.js script using `@supabase/supabase-js`:
```js
// upload-animations.mjs
// Takes: unit, lesson, glob of MP4 files
// Uploads to: bucket/apstats-u{U}/apstat_{UL}_*.mp4
```

**Requirements**: Supabase project ref + service role key (add to `.env`).

---

### 3. Lesson Prep Launcher Script (MEDIUM priority)

**Eliminates**: Manual orchestration of Steps 3-6
**Time saved**: ~5 min of context switching + setup
**Status**: Not started

A single entry-point script that:
1. Reads the calendar to determine tomorrow's topic (or takes `--unit 6 --lesson 4`)
2. Runs video-ingest.mjs on the video files
3. Launches CC Session #1 (apstats-live-worksheet) with a pre-built prompt
4. Launches CC Session #2 (lrsl-driller) with a pre-built prompt
5. Waits for both to finish

```bash
node scripts/lesson-prep.mjs --unit 6 --lesson 4 \
  --videos "./videos/6-4a.mp4" "./videos/6-4b.mp4"
```

This is essentially a dispatch manifest (Phase 5 pattern from the Agent framework) applied to the lesson prep pipeline.

---

### 4. URL Assembly + Clipboard Script (MEDIUM priority)

**Eliminates**: Step 11 (manual URL collection)
**Time saved**: ~2 min → instant
**Status**: Not started

```bash
node scripts/lesson-urls.mjs --unit 6 --lesson 4
```

Output:
```
Worksheet: https://robjohncolson.github.io/apstats-live-worksheet/u6_lesson4_live.html
Blooket:   [paste from clipboard after upload]
Drills:    https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l17-state-null
Quiz:      https://robjohncolson.github.io/curriculum_render/?u=6&l=3

[All URLs copied to clipboard]
```

**Challenge**: The drills deep-link level slug requires knowing the first new mode ID. Could parse `manifest.json` to auto-detect. Blooket URL can't be predicted (must come from upload).

---

### 5. Schoology API Integration (LOW priority, HIGH impact if achievable)

**Eliminates**: Step 12 (manual link posting)
**Time saved**: ~3-5 min → ~10 sec
**Status**: Needs research — requires OAuth 1.0 API key from school admin

Schoology has a [REST API](https://developers.schoology.com/api/) that supports creating assignments/materials programmatically. If API access is available:

```bash
node scripts/post-to-schoology.mjs --unit 6 --lesson 4 \
  --blooket-url "https://..." \
  --course-id 12345 --section-id 67890
```

**Blocker**: API key must be provisioned by a Schoology admin (School Management > Integration > API). As a teacher you may not have admin access — worth asking IT.

---

### 6. Blooket Upload Automation (LOW priority)

**Eliminates**: Step 7 (manual CSV upload)
**Time saved**: ~2-3 min
**Status**: No public API exists

**Options**:
- **Browser extension / userscript**: A Tampermonkey script that auto-fills the CSV import form when it detects a Blooket CSV in the clipboard or downloads folder
- **Puppeteer/Playwright script**: Headless browser automation to upload CSV and extract resulting URL
- **Accept the manual step**: At ~2 min, this may not be worth automating

---

### 7. Calendar Auto-Reader (LOW priority)

**Eliminates**: Step 1 (manual calendar check)
**Time saved**: ~1 min
**Status**: Not started

Parse the calendar HTML to extract tomorrow's topic programmatically:
```bash
node scripts/whats-tomorrow.mjs
# Output: "Thursday Mar 5 — Period B: Topic 6.4, Period E: Topic 5.8"
```

Tiny time saving but removes one cognitive step and could feed into the launcher script.

---

## Projected Timeline: Fully Automated

| Phase | Steps | Time (automated) | Notes |
|-------|-------|-------------------|-------|
| A. Content Extraction | 1-4 | ~12-17 min | Step 2 (recording) is irreducible; Steps 3-4 automated |
| B. Content Generation | 5-6 | ~10-15 min | Already efficient; launcher saves setup time |
| C. Distribution | 7-12 | ~4-7 min | Supabase + URL assembly automated; Blooket + Schoology still manual |
| **Total** | **12** | **~26-39 min** | **~40% reduction** |

If Schoology API access is obtained:
| **Total (with Schoology API)** | **12** | **~22-33 min** | **~50% reduction** |

---

## Implementation Priority Order

1. **Video ingest script** — already built, just needs testing (Step 3-4)
2. **Supabase upload script** — straightforward CLI/API (Step 8)
3. **URL assembly script** — pure string construction (Step 11)
4. **Lesson prep launcher** — orchestrates 1-3 above (Steps 3-6)
5. **Schoology API** — needs admin coordination (Step 12)
6. **Blooket automation** — Puppeteer if worth it (Step 7)
7. **Calendar reader** — nice-to-have (Step 1)

---

## Architecture Note

This pipeline is an instance of the **dispatch-harvest-evaluate** pattern documented in `CONTINUATION_PROMPT.md`:
- **Hub** (you) dispatches to specialists (Gemini for video, CC for code)
- **Workers** produce independently (two CC sessions, Gemini prompts)
- **Hub** evaluates, integrates, and distributes (Schoology, Blooket, Supabase)

The automation improvements move relay work from the hub to scripts, while keeping the human in the loop for quality judgment and the irreducible steps (video recording, Schoology posting).
