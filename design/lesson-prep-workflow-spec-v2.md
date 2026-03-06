# Lesson Prep Workflow Spec v2

**Author**: Agent (revised 2026-03-05 after first automated 6.5 cycle)
**Supersedes**: `lesson-prep-workflow-spec.md` (v1, estimates only)
**Observation**: #44 (original), plus live debugging session for 6.5

---

## Overview

A repeatable pipeline that produces all student-facing materials for one AP Statistics lesson. Touches 3 repos, 2 LLMs, and 4 external platforms. After the 6.5 cycle, the realistic time is **~25-35 minutes** with automation, down from ~45-60 manual.

## Inputs

| Input | Source | Format |
|-------|--------|--------|
| Unit + Lesson number | `whats-tomorrow.mjs` or manual | e.g. `u=6, l=5` |
| AP Classroom video Google Drive IDs | Google Drive share links | 1-3 per lesson |

## Outputs (per lesson)

| Artifact | Repo | Destination |
|----------|------|-------------|
| 4 video context files | `apstats-live-worksheet/u{N}/` | Consumed by CC during generation |
| Live worksheet HTML | `apstats-live-worksheet` | GitHub Pages → Schoology |
| AI grading prompts JS | `apstats-live-worksheet` | Used by worksheet at runtime |
| Blooket CSV | `apstats-live-worksheet` | blooket.com → Schoology |
| Cartridge extension | `lrsl-driller` | Vercel auto-deploy → Schoology |
| Manim animation .py files | `lrsl-driller/animations/` | Rendered to MP4 |
| Rendered MP4 animations | Supabase `videos` bucket | `animations/{cartridge-id}/{AssetName}.mp4` |
| Quiz URL | `curriculum-render` | Already on GitHub Pages → Schoology |

---

## The Pipeline (7 Steps)

### Step 1 — Check tomorrow's topic (~1 min)

```bash
node scripts/whats-tomorrow.mjs
```

**Output**: Unit, lesson, topic name, due/assigned items.
**Status**: Working, no changes needed.

---

### Step 2 — Video transcription via CDP (~15-20 min)

**Prerequisite**: Edge running with `--remote-debugging-port=9222`, logged into AI Studio.

```bash
scripts/start-edge-debug.cmd                    # one-time, or if Edge isn't running
node scripts/aistudio-ingest.mjs --unit 6 --lesson 5 \
  --drive-ids "DRIVE_ID_1" "DRIVE_ID_2"
```

**What happens**:
1. Script connects to Edge via CDP
2. For each video: opens new AI Studio chat, clicks paperclip → Drive
3. **User picks file in Drive picker** (~2 sec per video, 4 picks total)
4. Script types prompt via clipboard paste, submits via Ctrl+Enter
5. Waits for model response (watches for Stop button → done, >500 char turn)
6. Extracts response text from longest turn, saves to `u{N}/apstat_{U}-{L}-{V}_{type}.txt`
7. Second prompt (slides) stays in same chat — no re-attach needed

**Resume support**: Skips any output file already >500 bytes.

**Key learnings from 6.5 cycle**:
- Gemini 3.1 Pro has **zero API quota** — web UI via CDP is the only free path
- `fill()` doesn't trigger Angular — must use clipboard paste (Ctrl+V)
- Submit via **Ctrl+Enter**, not button click (button text changes: Add/Run/Stop)
- Response detection: wait for Stop button to disappear + turn with >500 chars
- Must wait ≥10 sec after attachment for video processing before submitting
- Drive picker is cross-origin iframe — cannot be automated, user picks manually

**Output**: 4 text files in `apstats-live-worksheet/u{N}/`

---

### Step 3 — Content generation (~10-15 min, parallel)

Two agents run simultaneously:

**Agent A: Worksheet + Grading + Blooket** (apstats-live-worksheet)
- Reads video context files from Step 2
- Generates `u{U}_lesson{L}_live.html` (~1200-1400 lines)
- Generates `ai-grading-prompts-u{U}-l{L}.js` (~150-200 lines)
- Generates `u{U}_l{L}_blooket.csv` (~35-42 questions)
- Commits and pushes

**Agent B: Cartridge + Animations** (lrsl-driller)
- Reads video context files from Step 2
- Extends `cartridges/apstats-u6-inference-prop/` (manifest, generator, grading-rules, ai-grader-prompt)
- Generates 5-7 Manim `.py` animation scripts in `animations/`
- Commits and pushes

---

### Step 4 — Render Manim animations (~2-3 min)

```bash
node scripts/render-animations.mjs --unit 6 --lesson 5
```

**What it does**:
1. Finds all `animations/apstat_{UL}_*.py` files for the lesson
2. Renders each with `python -m manim render -ql` (low quality for speed)
3. Sets ffmpeg PATH automatically
4. Reports rendered file paths + sizes

**Requirements**: Python 3.12 + manim + ffmpeg (all present on this machine)

---

### Step 5 — Upload animations to Supabase (~1 min)

```bash
node scripts/upload-animations.mjs --unit 6 --lesson 5
```

**What it does**:
1. Reads cartridge `manifest.json` to map mode animation references → asset names
2. Finds rendered MP4s in `media/videos/` Manim output dirs
3. Maps rendered scene names to manifest asset names (e.g. `TestStatisticZScore.mp4` → `TestStatistic.mp4`)
4. Uploads to `videos/animations/{cartridge-id}/{AssetName}.mp4` in Supabase
5. Uses service_role key from `.env`

**Bucket**: `videos` (not `animations`)
**Path pattern**: `animations/{cartridge-id}/{AssetName}.mp4`

---

### Step 6 — Generate URLs (~instant)

```bash
node scripts/lesson-urls.mjs --unit 6 --lesson 5
```

Outputs 4 URLs to stdout + clipboard:
1. Worksheet (GitHub Pages)
2. Drills (Vercel, deep-link to first new mode)
3. Quiz (GitHub Pages, previous lesson)
4. Blooket (placeholder — manual upload)

---

### Step 7 — Distribution (manual, ~5 min)

- [ ] Upload Blooket CSV to blooket.com, copy URL
- [ ] Post all 4 links to Schoology

**Not automatable**: Blooket has no API. Schoology API exists but requires admin-provisioned OAuth key.

---

## Timing Summary (actual from 6.5 cycle)

| Step | Time | Automation level |
|------|------|-----------------|
| 1. Check tomorrow | ~1 min | Fully automated |
| 2. Video transcription (CDP) | ~15-20 min | Semi-auto (4 Drive picker clicks) |
| 3. Content generation | ~10-15 min | Fully automated (parallel) |
| 4. Render animations | ~2-3 min | Fully automated |
| 5. Upload to Supabase | ~1 min | Fully automated |
| 6. Generate URLs | instant | Fully automated |
| 7. Schoology + Blooket | ~5 min | Manual |
| **Total** | **~25-35 min** | |

**vs manual**: ~45-60 min → **~40-50% reduction**

---

## Scripts Inventory

| Script | Location | Status |
|--------|----------|--------|
| `whats-tomorrow.mjs` | `Agent/scripts/` | Working |
| `start-edge-debug.cmd` | `Agent/scripts/` | Working |
| `aistudio-ingest.mjs` | `Agent/scripts/` | Working (needs cleanup commit) |
| `lesson-urls.mjs` | `Agent/scripts/` | Working |
| `lesson-prep.mjs` | `Agent/scripts/` | **Needs rewrite** — orchestrator doesn't match real pipeline |
| `render-animations.mjs` | `Agent/scripts/` | **Needs creation** |
| `upload-animations.mjs` | `lrsl-driller/scripts/` | **Needs rewrite** — wrong bucket, path, file discovery |
| `video-ingest.mjs` | `apstats-live-worksheet/` | **Dormant** — Gemini 3.1 Pro has zero API quota |
| `bookmarklets.html` | `Agent/scripts/` | Working (fallback) |
| `probe-aistudio.mjs` | `Agent/scripts/` | Debug tool, keep |

---

## Supabase Storage Convention

```
Bucket: videos
Path:   animations/{cartridge-id}/{AssetName}.mp4

Example: videos/animations/apstats-u6-inference-prop/TestStatistic.mp4
```

**Asset naming**: The manifest references `assets/{Name}.mp4`. The platform's asset resolver maps this to the Supabase URL. The uploaded filename must match the manifest's `animation` field basename.

**Scene name → Asset name mapping**: Manim renders to `{SceneClassName}.mp4` but the manifest uses a shorter name. The upload script must read the manifest to build this mapping. Convention: strip the prefix (e.g. `TestStatisticZScore` → `TestStatistic`).

---

## Implementation Revisions Needed

### R1: Rewrite `upload-animations.mjs` (lrsl-driller)
- Default bucket: `videos`
- Upload path: `animations/{cartridge-id}/{AssetName}.mp4`
- Read manifest.json to discover expected asset names
- Match rendered MP4s to manifest assets by fuzzy scene-name matching
- Only upload files that are new/changed (compare size or hash)

### R2: Create `render-animations.mjs` (Agent)
- Find `.py` files for a given unit+lesson
- Run `python -m manim render -ql` with ffmpeg PATH set
- Report rendered MP4 paths for upload step

### R3: Rewrite `lesson-prep.mjs` (Agent)
- Remove video-ingest.mjs step (dormant)
- Step 1: whats-tomorrow (if --auto)
- Step 2: aistudio-ingest via CDP (prompt for Drive IDs)
- Step 3: parallel content generation agents
- Step 4: render-animations.mjs
- Step 5: upload-animations.mjs
- Step 6: lesson-urls.mjs
- Step 7: print manual checklist

### R4: Clean up `aistudio-ingest.mjs` (Agent)
- Remove dead code (old launch path, old selectors)
- Commit the working CDP version with all fixes
- Add `--model` default note in help text (Gemini 3.1 Pro, zero API quota)

### R5: Update `video-ingest.mjs` status (apstats-live-worksheet)
- Add comment at top: "DORMANT — Gemini 3.1 Pro has zero free API quota as of March 2026"
- Keep the script for future use if quota becomes available
