# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## Context

You are the **Agent** — an LLM routing intelligence layer that also houses the **lesson prep automation pipeline** for AP Statistics teaching. The pipeline automates the full workflow from calendar lookup to Schoology posting.

### Machine: Work (ColsonR)

Base path: `C:/Users/ColsonR` — Lynn Public Schools, Windows 11 Education.

### What just happened (2026-03-06)

We completed a **full end-to-end pipeline run** for Tuesday 3/10/26 (Topic 6.7 — Potential Errors: Type I & II). Everything succeeded:

1. **Video ingest** (Step 1) — 2 videos processed through AI Studio/Gemini via CDP. Fixed a CDK overlay bug in `aistudio-ingest.mjs` that was blocking textarea clicks (solution: remove `.cdk-overlay-backdrop` elements + press Escape before clicking).

2. **Content generation** (Step 2) — **Major refactor completed.** Replaced broken Codex CLI subprocess spawning with self-contained prompt files piped via stdin. New architecture: `scripts/lib/build-codex-prompts.mjs` builds 3 detailed prompts (worksheet, Blooket, drills) with inline video context + pattern files. Runs 3 parallel Codex tasks with output validation. See `design/step2-content-gen-spec.md` for the full spec.

3. **Blooket upload** (Step 5) — CSV auto-uploaded via CDP, URL captured: `https://dashboard.blooket.com/set/69ab32e0d721c5ea7bb4c56e`

4. **Schoology posting** (Step 6) — Folder "Tuesday 3/10/26" created, **all 6 links posted INSIDE the folder** (fixed the folder scoping bug by extracting folder ID from `tr[id^="f-"]` and navigating to `?f={folderId}`). Calendar link posted at top level with duplicate detection.

5. **Pipeline gating** — Steps now abort on failure instead of blindly continuing. Step 1 failure blocks Step 2; Step 2 failure blocks Steps 3-6.

### Bugs fixed this session
- **CDK overlay in AI Studio** — `aistudio-ingest.mjs:313` removes overlay backdrops before clicking textarea
- **Folder scoping** — `post-to-schoology.mjs` `extractFolderUrl()` replaces broken `navigateIntoFolder()`, uses `?f={id}` URL
- **Codex spawning** — rewrote Step 2 entirely (see above)
- **Calendar link duplication** — `post-to-schoology.mjs` checks for existing calendar link title on materials page before posting

### Files modified this session
- `scripts/lesson-prep.mjs` — pipeline gating, Step 2 rewrite (parallel Codex with prompt files + validation)
- `scripts/lib/build-codex-prompts.mjs` — NEW: builds self-contained prompts for worksheet/Blooket/drills
- `scripts/post-to-schoology.mjs` — folder scoping fix (`extractFolderUrl`), calendar duplicate check
- `scripts/aistudio-ingest.mjs` — CDK overlay dismissal fix
- `design/step2-content-gen-spec.md` — NEW: spec for the Step 2 refactor
- `dispatch/prompts/codex-agents/step2-content-gen.md` — NEW: Codex prompt for the refactor

### Immediate priority: Animation rendering (Steps 3-4)

Steps 3 and 4 currently do nothing useful:
- **Step 3** (`render-animations.mjs`) looks for `apstat_67_*.py` Manim files — none exist for 6.7
- **Step 4** (`upload-animations.mjs`) finds animation references in `manifest.json` modes but no rendered MP4s

The drills cartridge modes (created by Codex in Step 2) reference animation files like `IdentifyErrorType.mp4`, `PowerAndErrorProbabilities.mp4`, etc. — but nobody creates the Manim `.py` source files or renders them.

**What needs to happen:**
1. Understand the existing animation pipeline: how do `.py` files get created? What naming convention? Where do rendered MP4s go?
2. Either: add animation generation to the Step 2 Codex prompts (the drills prompt already mentions it but Codex may not be creating the `.py` files), or create a separate step
3. Fix `render-animations.mjs` glob pattern if needed (currently `apstat_67_*.py` — is that right?)
4. Fix `upload-animations.mjs` to find rendered files and upload to Supabase
5. Ensure the full loop works: Codex creates `.py` → Step 3 renders to MP4 → Step 4 uploads to Supabase → drills platform loads them

### Repos on this machine

| Repo | Path | Description |
|------|------|-------------|
| **apstats-live-worksheet** | `C:/Users/ColsonR/apstats-live-worksheet` | AP Stats worksheets, calendar HTMLs, Blooket CSVs |
| **curriculum-render** | `C:/Users/ColsonR/curriculum_render` | Consensus Quiz app + `data/units.js` (video links) |
| **lrsl-driller** | `C:/Users/ColsonR/lrsl-driller` | Drill platform, cartridges with mode manifests |
| **Agent** | `C:/Users/ColsonR/Agent` | This repo — pipeline orchestrator, CDP scripts, LLM profiles |

### Pipeline command reference

```bash
# Full auto (detects tomorrow's lesson):
node scripts/lesson-prep.mjs --auto

# Prep for a specific date:
node scripts/lesson-prep.mjs --auto --date 2026-03-10

# Skip ingest (video context already captured):
node scripts/lesson-prep.mjs --auto --date 2026-03-10 --skip-ingest

# Just Schoology posting (all content exists):
node scripts/lesson-prep.mjs --unit 6 --lesson 7 --date 2026-03-10 \
  --skip-ingest --skip-render --skip-upload --skip-blooket

# Direct Schoology post with all features:
node scripts/post-to-schoology.mjs --unit 6 --lesson 7 --auto-urls --with-videos \
  --blooket "URL" --create-folder "Tuesday 3/10/26" \
  --folder-desc "6.7 Potential Errors\nDue: Quiz 6.5\nAssign: Drills 6.7, Quiz 6.6" \
  --calendar-link "URL" --calendar-title "Week Calendar (mar9)"

# Dry run (no browser needed):
node scripts/post-to-schoology.mjs --unit 6 --lesson 7 --auto-urls --with-videos --dry-run
```

### Key architectural decisions
- Schoology/Blooket/AI Studio automation uses Playwright CDP connecting to Edge on port 9222
- Step 2 uses `codex exec --full-auto` with stdin piping on Windows (`cmd /c codex.cmd exec --full-auto -`)
- Prompts embed ALL context inline — video transcriptions + pattern files — so Codex doesn't need repo exploration
- Calendar link duplicate detection scans materials page for matching title before posting
- Pipeline gating: Step 1 failure → abort; Step 2 failure → abort; Steps 3-5 non-blocking

I am a high school math teacher building educational tools. My main projects are AP Statistics teaching tools. I want the lesson prep workflow to be as automated as possible — ideally I say "prep for Monday" and everything happens.
