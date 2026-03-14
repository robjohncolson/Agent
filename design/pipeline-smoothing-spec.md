# Pipeline Smoothing Spec — Friction Fixes from 2026-03-13 Session

**Status: ALL 7 FIXES COMPLETE (2026-03-13)**

## Goal

Eliminate recurring friction points in the lesson prep pipeline, Codex dispatch, and Schoology posting workflows. These are all derived from observed failures in a single session.

## Fix 1: Test Batch Commands with 1 Item First

**Problem:** Backfill scripts failed on every lesson because `--target-folder` was missing, then wrong format. Two full debug cycles wasted.

**Change:** Before running any new batch script for the first time, run it for a single lesson and verify success. Codify this in backfill scripts with a `--test-one` flag that processes only the first item and exits.

**Files:** `scripts/backfill-schoology-videos.mjs`, `scripts/backfill-period-e.mjs`, any future batch scripts.

**Acceptance:** `--test-one` processes 1 lesson, prints result, exits.

---

## Fix 2: Skip Codex for Small Changes

**Problem:** Agent B was a 2-line change dispatched to Codex — it timed out after 120s even though the patch was applied in seconds. Agent A spent 180s researching and never applied a patch.

**Change:** Add a decision rule to the dispatch skill: if a task involves fewer than ~10 lines of changes with clear before/after, implement CC-direct instead of dispatching to Codex.

**Files:** `dispatch/` skill instructions, possibly `.claude/skills/dispatch/instructions.md`

**Acceptance:** Dispatch skill docs include the threshold rule.

---

## Fix 3: Post-Pipeline 3-Repo Commit Check

**Problem:** After 7.6 pipeline completed, lrsl-driller changes weren't pushed. User saw missing drills on the live site.

**Change:** Add a `post-pipeline-commit.mjs` script (or extend `lesson-prep.mjs`) that after all steps complete:
1. Checks for uncommitted changes in Agent, apstats-live-worksheet, and lrsl-driller
2. Commits each repo with a standard message
3. Pushes all three
4. Prints summary

**Files:** `scripts/post-pipeline-commit.mjs` (new), or add to `scripts/lesson-prep.mjs` as a final step.

**Acceptance:** After a pipeline run, all three repos are committed and pushed without manual intervention.

---

## Fix 4: Verify File Existence Before Posting to Schoology

**Problem:** Period E backfill posted worksheet links for ~22 lessons where the HTML file doesn't exist (404s). Required a cleanup script.

**Change:** In `post-to-schoology.mjs`, before posting a worksheet link, check if the corresponding file exists in the worksheet repo. If not, skip that material type and log a warning.

Add a `--skip-missing` flag (default on for batch scripts) that:
- Extracts the filename from the URL
- Checks `WORKSHEET_REPO/<filename>` exists
- Skips posting if file is missing
- Logs: `SKIP: worksheet file not found locally — u1_lesson3_live.html`

**Files:** `scripts/post-to-schoology.mjs` (modify), `scripts/backfill-period-e.mjs` (pass flag)

**Acceptance:** Running the Period E backfill with `--skip-missing` does not post phantom worksheet links.

---

## Fix 5: Auto-Populate apVideos + Drills URL in Pipeline

**Problem:** After 7.6 pipeline completed, the registry was missing `urls.drills` and `urls.apVideos`. Had to manually patch. Status showed "partial" instead of "ready".

### Fix 5a: Auto-populate apVideos during ingest

**Change:** In the ingest step of `lesson-prep.mjs`, after transcripts are extracted, call `loadVideoLinks(unit, lesson)` from the shared module and write the result to `registry[key].urls.apVideos`.

**Files:** `scripts/lesson-prep.mjs` (modify ingest step), import from `scripts/lib/load-video-links.mjs`

### Fix 5b: Auto-populate drills URL after content-gen-drills

**Change:** After `content-gen-drills` completes, read the cartridge manifest to find the first level ID for this lesson's drills, and construct + save the drills URL to the registry.

Logic:
1. Read `cartridges/<cartridge>/manifest.json`
2. Find the tier(s) added for this lesson (by convention, the last N tiers)
3. Construct URL: `https://lrsl-driller.vercel.app/platform/app.html?c=<cartridge>&level=<firstTierId>`
4. Write to `registry[key].urls.drills`

**Files:** `scripts/lesson-prep.mjs` or `scripts/workers/codex-content-gen.mjs` (modify), `scripts/lib/paths.mjs` (DRILLER_REPO already exported)

**Acceptance:** After a full pipeline run, `urls.drills` and `urls.apVideos` are populated without manual patching.

---

## Fix 6: Save Working Edge CDP Launch Pattern

**Problem:** Multiple failed attempts to start Edge with CDP. `cmd.exe /c start` didn't work. Direct path with `&` worked.

**Change:** Standardize the CDP launch in `scripts/lib/cdp-connect.mjs` or a helper:
- Before connecting, check if CDP is already available (`curl localhost:9222`)
- If not, attempt to launch Edge directly:
  ```
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    --remote-debugging-port=9222 \
    --user-data-dir="C:/Users/ColsonR/.edge-debug-profile" &
  ```
- Wait up to 10s for CDP to become available
- If still not available, print clear message: "Close all Edge windows and retry"

**Files:** `scripts/lib/cdp-connect.mjs` (modify)

**Acceptance:** `connectCDP()` auto-launches Edge if CDP isn't running, with a clear error if it can't.

---

## Fix 7: Increase Codex Dispatch Timeout

**Problem:** All 3 Codex agents timed out at 120s/180s. They apply patches quickly but spend remaining time on post-patch verification.

**Change:**
- Default timeout in `runner/cross-agent.py`: increase from 120s to 300s
- Add instruction to subagent preamble: "After applying patches, write the result file and exit immediately. Do not run verification commands."

**Files:** `runner/cross-agent.py` (default timeout), subagent preamble template

**Acceptance:** Codex agents complete without timeout on typical tasks.

---

## Dependency Graph

```
Wave 1 (parallel, no dependencies):
  Fix 1: --test-one flag for batch scripts
  Fix 2: Dispatch threshold rule (docs only)
  Fix 6: CDP auto-launch
  Fix 7: Codex timeout increase

Wave 2 (parallel, no dependencies):
  Fix 3: Post-pipeline 3-repo commit
  Fix 4: --skip-missing for poster

Wave 3 (depends on existing shared modules):
  Fix 5a: Auto-populate apVideos in pipeline
  Fix 5b: Auto-populate drills URL in pipeline
```

## Estimated Effort

| Fix | Size | Files |
|-----|------|-------|
| 1. --test-one flag | S | 2 batch scripts |
| 2. Dispatch threshold | S | Docs only |
| 3. Post-pipeline commit | M | 1 new script or modify lesson-prep |
| 4. --skip-missing | M | post-to-schoology.mjs + batch scripts |
| 5a. Auto apVideos | S | lesson-prep.mjs |
| 5b. Auto drills URL | M | lesson-prep.mjs or content-gen worker |
| 6. CDP auto-launch | M | cdp-connect.mjs |
| 7. Codex timeout | S | cross-agent.py + preamble |
