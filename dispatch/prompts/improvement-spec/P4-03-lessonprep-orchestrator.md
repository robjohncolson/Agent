# Agent: Lesson Prep Orchestrator V3

## Phase
P4-pipeline-recovery | Depends on: whisper-integration | Working dir: `C:/Users/ColsonR/apstats-live-worksheet`

## Objective
Rewrite the lesson prep pipeline orchestrator with explicit dependency-aware step execution, parallel content generation where safe, and graceful fallbacks.

## Dependencies
- **whisper-integration** must be complete (provides `video-ingest-whisper.mjs`)

## Context: The Lesson Prep Dependency Graph

```
INPUT: unit number, lesson number (e.g., Unit 6, Lesson 3)

STEP 1: CALENDAR CHECK (no deps)                    ← Can run immediately
  └─ scripts/whats-tomorrow.mjs
  └─ OUTPUT: { unit, lesson, topic, date }

STEP 2: TRANSCRIPT (no deps)                        ← Can parallel with Step 1
  ├─ Check: u{N}/apstat_{N}-{L}-*_transcript.txt exists?
  ├─ If yes → skip (already transcribed)
  ├─ If no → video-ingest-whisper.mjs (new) or aistudio-ingest.mjs (fallback)
  └─ OUTPUT: transcript file path

STEP 3: RUBRIC (depends on: Step 2 transcript)
  ├─ Check: ai-grading-prompts-u{N}-l{L}.js exists?
  ├─ If yes → skip
  ├─ If no → generate from:
  │   ├─ curriculum_render/data/frameworks.js (AP learning objectives)
  │   ├─ Step 2 transcript (for contextFromVideo timestamps)
  │   └─ Rubric schema: { questionText, expectedElements[], scoringGuide, commonMistakes[] }
  └─ OUTPUT: rubric JS file path

STEP 4a: WORKSHEET (depends on: Step 2 + Step 3)    ┐
  ├─ Check: u{N}_lesson{L}_live.html exists?         │
  ├─ If no → generate using live-worksheet skill      ├─ PARALLEL BLOCK
  └─ OUTPUT: worksheet HTML file path                 │
                                                      │
STEP 4b: BLOOKET (depends on: Step 3 only)           │
  ├─ Check: u{N}_l{L}_blooket.csv exists?             │
  ├─ If no → generate using blooket-quiz skill        │
  └─ OUTPUT: Blooket CSV file path                    ┘

STEP 5: ANIMATIONS (depends on: Step 3 rubric for mode list)
  ├─ Check: which modes need animations (from manifest or rubric)
  ├─ render-animations.mjs --unit N --lesson L
  ├─ upload-animations.mjs --unit N --lesson L
  └─ OUTPUT: animation URLs
  └─ NOTE: Non-blocking — pipeline continues if this fails

STEP 6: REPORT + COMMIT
  ├─ List all files created/skipped
  ├─ Ask user to review
  └─ If approved → git add, commit, push
```

## Read First
1. `Agent/scripts/lesson-prep.mjs` — **EXISTING orchestrator** (recently refactored, uses centralized paths).
   This file already has the 10-step pipeline. We are MODIFYING it, not creating a new file.
2. `Agent/scripts/lib/paths.mjs` — **CRITICAL**: Centralized path config with machine-aware auto-detection.
   All scripts now import paths from here. lesson-prep.mjs already uses:
   `import { SCRIPTS, WORKING_DIRS, DRIVE_VIDEO_INDEX_PATH, CALENDAR_DIR, WORKSHEET_REPO, DOWNSTREAM_REPOS } from "./lib/paths.mjs"`
3. `Agent/scripts/verify-paths.mjs` — Run this first to validate all paths resolve.
4. `Agent/design/lesson-prep-workflow-spec-v2.md` — workflow design
5. `Agent/design/step2-content-gen-spec.md` — parallel content generation spec
6. `video-ingest-whisper.mjs` — new Whisper integration (from P4-01)

## Owned Paths
- `Agent/scripts/lesson-prep.mjs` (MODIFY existing, not create new)

## Implementation Approach

**Do NOT create a new file.** Modify the existing `Agent/scripts/lesson-prep.mjs` which already:
- Imports from `lib/paths.mjs` (centralized, machine-aware paths)
- Has the 10-step pipeline structure (calendar → ingest → codegen → render → upload → post → commit)
- References scripts via `SCRIPTS.whatsTomorrow`, `SCRIPTS.aistudioIngest`, etc.

The main changes are:
1. Add Whisper as primary transcription (Step 1), AI Studio as fallback
2. Add dependency checks between steps (skip if output exists)
3. Make Steps 4a/4b (worksheet + blooket) parallel where safe

```javascript
// In the existing lesson-prep.mjs, modify the step1 function:
import { SCRIPTS, WORKING_DIRS, WORKSHEET_REPO, DOWNSTREAM_REPOS } from './lib/paths.mjs';
import { existsSync } from 'fs';

// No new file — these are changes to existing lesson-prep.mjs

async function main() {
  console.log(`\n=== Lesson Prep: Unit ${unit}, Lesson ${lesson} ===\n`);

  // STEP 1 + 2: No dependencies — run in parallel
  const [calendarResult, transcriptResult] = await Promise.all([
    step1_calendarCheck(unit, lesson),
    step2_transcript(unit, lesson)
  ]);

  // STEP 3: Depends on Step 2 (transcript)
  const rubricResult = await step3_rubric(unit, lesson, transcriptResult);

  // STEP 4a + 4b: Parallel — worksheet needs transcript+rubric, blooket needs rubric only
  const [worksheetResult, blooketResult] = await Promise.all([
    step4a_worksheet(unit, lesson, transcriptResult, rubricResult),
    step4b_blooket(unit, lesson, rubricResult)
  ]);

  // STEP 5: Non-blocking animations (fire and forget)
  const animationPromise = step5_animations(unit, lesson, rubricResult)
    .catch(err => ({ status: 'skipped', reason: err.message }));

  // STEP 6: Report
  const animationResult = await animationPromise;
  report(unit, lesson, {
    calendar: calendarResult,
    transcript: transcriptResult,
    rubric: rubricResult,
    worksheet: worksheetResult,
    blooket: blooketResult,
    animations: animationResult
  });
}

async function step2_transcript(unit, lesson) {
  const transcriptGlob = `u${unit}/apstat_${unit}-${lesson}-*_transcript.txt`;
  // Check if exists → skip
  // Else → call video-ingest-whisper.mjs
}

// ... other steps follow same pattern: check exists → skip or generate
```

## Constraints
- Check for existing outputs before regenerating (idempotent)
- Parallel steps must not share mutable state
- Animation step is non-blocking (nice-to-have, not required)
- Whisper is the PRIMARY transcription method; AI Studio is fallback

## Verification
```bash
# Dry run (check existence only, don't generate)
node scripts/lesson-prep-v3.mjs 6 3 --dry-run

# Full run
node scripts/lesson-prep-v3.mjs 6 3
```
