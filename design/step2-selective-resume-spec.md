# Step 2 Selective Resume — Spec

## Problem

The lesson-prep pipeline's Step 2 (content generation) uses all-or-nothing resume logic.
Three independent Codex tasks run in parallel: **worksheet**, **blooketCsv**, **drills**.
If even one sub-task isn't marked "done" in the registry, all three re-run — wasting
Codex tokens and ~5 minutes on work that's already complete.

### Root Cause

1. **Orchestration gap**: `canResume()` is called per sub-task, but the results are
   collapsed into a single boolean `allStep2Done`. When false, the entire
   `step2_contentGeneration()` function runs all 3 tasks unconditionally.

2. **Stale registry status**: A previous run generated `u6_l4_blooket.csv` but
   crashed or was interrupted before `updateStatus(unit, lesson, "blooketCsv", "done")`
   executed, leaving the status as `"pending"`.

### Observed Impact (2026-03-10)

- Registry: `worksheet: done`, `drills: done`, `blooketCsv: pending`
- Blooket CSV file existed on disk (11KB, valid)
- Pipeline re-ran all 3 Codex tasks (~5 min each, 3 API calls to GPT-5.4)

## Solution

### Part A: Selective per-task skip in Step 2

Pass individual resume flags into `step2_contentGeneration()` so it builds and
launches only the tasks that actually need work. Already-done tasks return
synthetic success results without spawning Codex.

**Changes to `scripts/lesson-prep.mjs`:**

1. **Extend `step2_contentGeneration` signature** to accept a `skipTasks` set:
   ```js
   async function step2_contentGeneration(unit, lesson, opts = {}, skipTasks = new Set())
   ```

2. **Filter tasks before launch**: After building the tasks array, remove entries
   whose key is in `skipTasks`. For skipped tasks, immediately push a synthetic
   `{ label, success: true, skipped: true }` result.

3. **Refactor orchestration block** (lines ~1735-1771): Instead of the all-or-nothing
   `if (allStep2Done) / else` branch, build a `skipTasks` set from the individual
   `canResume()` results and always call `step2_contentGeneration()` with it.
   Log which sub-tasks are being skipped at the Step 2 banner.

4. **Handle edge case**: If all 3 are skippable, still skip entirely (no need
   to enter the function at all). This preserves the existing fast path.

### Part B: Registry self-heal on resume

When `canResume()` returns `{ skip: false }` for a sub-task but the output
artifact exists on disk, the orchestration should update the registry to "done"
before deciding whether to skip. This prevents stale "pending" statuses from
causing unnecessary re-runs.

**Changes to `scripts/lesson-prep.mjs`:**

1. **Add `healRegistry()` helper** (or inline logic): After computing
   `step2WorksheetResume`, `step2BlooketResume`, `step2DrillsResume`, check
   if the artifact file exists on disk for any task that returned `skip: false`.
   If the file exists and passes a basic sanity check (non-empty, valid format),
   update the registry to "done" and flip the resume flag to skip.

2. **Apply to Step 2 sub-tasks only** (worksheet needs file, blooketCsv needs
   file, drills has no single artifact — skip heal for drills).

## Non-goals

- No new CLI flags needed (the existing `--force` and `--force-step` already
  cover manual overrides).
- No changes to `canResume()` itself — it correctly returns `skip: false`
  for non-done statuses. The heal logic is a layer above it.
- No changes to Codex prompt building or task validation.

## Testing

1. Set registry to `worksheet: done, blooketCsv: pending, drills: done` with
   artifacts on disk. Run `--auto`. Verify only blooketCsv task runs (or is
   healed and skipped).
2. Delete the blooket CSV file, keep status as "pending". Run `--auto`. Verify
   the blooket task runs but worksheet/drills are skipped.
3. Run with `--force`. Verify all 3 tasks run regardless.
4. Run with `--force-step blooketCsv`. Verify only blooketCsv re-runs.
