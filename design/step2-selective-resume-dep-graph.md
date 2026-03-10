# Step 2 Selective Resume — Dependency Graph

## Tasks

```
T1: Registry self-heal logic (Part B)
    - Add artifact-existence check after canResume() for Step 2 sub-tasks
    - If artifact exists + status is "pending"/"failed", update to "done" and flip skip
    - File: scripts/lesson-prep.mjs (orchestration block, ~lines 1735-1745)
    - Depends on: nothing
    - Estimated: ~20 lines changed

T2: Selective skip in step2_contentGeneration (Part A core)
    - Add skipTasks parameter to step2_contentGeneration()
    - Filter tasks array, return synthetic results for skipped tasks
    - Log which tasks are skipped vs running
    - File: scripts/lesson-prep.mjs (step2_contentGeneration function, ~line 958)
    - Depends on: nothing
    - Estimated: ~25 lines changed

T3: Orchestration block refactor (Part A wiring)
    - Replace all-or-nothing branch with per-task skip set
    - Build skipTasks from canResume() results (after T1 heal)
    - Pass skipTasks to step2_contentGeneration()
    - Merge synthetic skip results with real results
    - File: scripts/lesson-prep.mjs (orchestration block, ~lines 1735-1771)
    - Depends on: T1, T2
    - Estimated: ~30 lines changed

T4: Fix stale 6.4 registry entry (quick patch)
    - Update blooketCsv status from "pending" to "done" in lesson-registry.json
    - This is a data fix, not a code fix — prevents the immediate re-run
    - File: state/lesson-registry.json
    - Depends on: nothing
    - Estimated: 1 line changed
```

## Dependency Graph

```
T1 (heal logic)  ──┐
                    ├──► T3 (orchestration wiring)
T2 (selective skip) ┘

T4 (registry data fix) ── independent
```

## Parallelization Plan

- **Wave 1** (parallel): T1, T2, T4
  - T1 and T2 touch different sections of the same file but don't overlap
  - T4 is a JSON data fix, fully independent

- **Wave 2** (sequential): T3
  - Depends on T1 and T2 being complete
  - Wires the heal logic (T1) and selective skip (T2) into the orchestration

## Risk Notes

- T1 and T2 both modify `lesson-prep.mjs` but in different functions/sections.
  Can be done in parallel if each targets non-overlapping line ranges.
- T3 replaces existing lines (~1735-1771) so it must be done after T1/T2 to
  avoid merge conflicts.
- T4 is safe to apply immediately and independently.
