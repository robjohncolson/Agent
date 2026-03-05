# Task: Create lesson prep launcher script

## Create file
`C:/Users/ColsonR/Agent/scripts/lesson-prep.mjs`

## Purpose
Single entry point that orchestrates the full lesson prep pipeline. Runs the independent steps in parallel where possible.

## Usage
```bash
node scripts/lesson-prep.mjs --unit 6 --lesson 4 \
  --videos "C:/path/to/6-4a.mp4" "C:/path/to/6-4b.mp4"
```

Or with auto-detection:
```bash
node scripts/lesson-prep.mjs --auto
# Uses whats-tomorrow.mjs to determine unit+lesson, prompts for video paths
```

## Pipeline orchestration

```
Phase A (sequential):
  1. Run whats-tomorrow.mjs to confirm the topic (if --auto)
  2. Run video-ingest.mjs to transcribe videos (if --videos provided)

Phase B (parallel):
  3a. Launch CC session in apstats-live-worksheet (worksheet + grading + blooket)
  3b. Launch CC session in lrsl-driller (cartridge + animations)

Phase C (after B completes):
  4. Run upload-animations.mjs (if Supabase credentials available)
  5. Run lesson-urls.mjs to assemble and display URLs
  6. Print remaining manual steps (Blooket upload, Schoology posting)
```

## Implementation

### Phase A — Video ingest
```js
import { execSync } from 'child_process';

// Only if --videos provided
execSync(`node C:/Users/ColsonR/apstats-live-worksheet/video-ingest.mjs ${unit} ${lesson} ${videoArgs}`,
  { stdio: 'inherit' });
```

### Phase B — Parallel CC sessions
Use `child_process.spawn` to run two processes in parallel:

**Session 1 (apstats-live-worksheet)**:
```bash
codex --full-auto --prompt "Generate a follow-along worksheet, AI grading prompts, and Blooket CSV for Topic {U}.{L}. Read the video context files in u{U}/ for the lesson content. Follow the patterns established by existing worksheets like u6_lesson3_live.html." --working-dir "C:/Users/ColsonR/apstats-live-worksheet"
```

**Session 2 (lrsl-driller)**:
```bash
codex --full-auto --prompt "Extend the apstats-u6-inference-prop cartridge with Topic {U}.{L} modes and generate Manim animations. Read the spec pattern from existing modes in manifest.json. Add new modes to manifest, generator, grading-rules, and ai-grader-prompt. Generate animation .py files in animations/." --working-dir "C:/Users/ColsonR/lrsl-driller"
```

Wait for both to complete. Print status as each finishes.

### Phase C — Distribution
```js
// Upload animations (if credentials available)
try {
  execSync(`node C:/Users/ColsonR/lrsl-driller/scripts/upload-animations.mjs --unit ${unit} --lesson ${lesson}`,
    { stdio: 'inherit' });
} catch (e) {
  console.log('Supabase upload skipped (no credentials or script not found)');
}

// Assemble URLs
execSync(`node C:/Users/ColsonR/Agent/scripts/lesson-urls.mjs --unit ${unit} --lesson ${lesson}`,
  { stdio: 'inherit' });
```

### Final output
Print a checklist of remaining manual steps:
```
=== Remaining Manual Steps ===
[ ] Upload u6_l4_blooket.csv to blooket.com
[ ] Commit + push apstats-live-worksheet
[ ] Commit + push lrsl-driller
[ ] Post all 4 links to Schoology
```

## Args parsing
Use `process.argv` — no external deps. Support:
- `--unit` / `-u` (required unless --auto)
- `--lesson` / `-l` (required unless --auto)
- `--videos` (optional, space-separated paths)
- `--auto` (uses whats-tomorrow.mjs)
- `--skip-ingest` (skip video transcription, assume context files exist)
- `--skip-upload` (skip Supabase upload)

## Dependencies (other scripts that must exist)
- `C:/Users/ColsonR/apstats-live-worksheet/video-ingest.mjs` (from task 01)
- `C:/Users/ColsonR/lrsl-driller/scripts/upload-animations.mjs` (from task 02)
- `C:/Users/ColsonR/Agent/scripts/lesson-urls.mjs` (from task 03)
- `C:/Users/ColsonR/Agent/scripts/whats-tomorrow.mjs` (from task 04)

All dependencies are optional — the launcher gracefully skips steps if a script is missing.

## Do NOT
- Add npm dependencies
- Modify any existing files
- Actually run CC sessions during implementation — just wire up the spawn calls
