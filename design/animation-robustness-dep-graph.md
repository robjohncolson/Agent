# Animation Upload Robustness Dependency Graph

1. Add the shared retry utility in `scripts/lib/fetch-retry.mjs` with exponential backoff and retry gating for network errors and 5xx responses only. [depends on: none]
2. Add per-file upload state load/save helpers and define the runtime schema for `state/animation-uploads.json` so each file can persist `status`, `url`, timestamps, `size_bytes`, `retries`, and `error`. [depends on: none]
3. Extend CLI argument parsing in `scripts/upload-animations.mjs` to support `--force`, `--dry-run`, and `--retry-failed` while preserving the existing `--unit` and `--lesson` targeting flow. [depends on: none]
4. Build the file-selection planner that merges discovered MP4s with persisted upload state and decides which files are in scope for this run under the default, `--force`, and `--retry-failed` modes. [depends on: 2,3]
5. Implement the Supabase idempotency probe for each candidate file using HEAD or equivalent object metadata lookup, including file identity comparison and skip decisions for already-uploaded matches. [depends on: 3]
6. Rework the main upload loop to execute the planner output, bypass idempotency when `--force` is set, honor `--dry-run`, call `fetchWithRetry` for actual uploads, and write per-file success/skip/failure results back to state after each file. [depends on: 1,2,4,5]
7. Emit structured lifecycle events through `event-log.mjs` for run start, per-file outcomes, and final summary using the counts and statuses produced by the planner and upload loop. [depends on: 4,6]
8. Update `tasks/upload-animations.json` so the task surface documents the new flags and the robustness behavior that now exists in the upload command. [depends on: 3,6]
9. Validate the end-to-end flows with the documented commands, covering dry-run behavior, failed-only retries, forced re-upload, and reruns that should skip already-uploaded files. [depends on: 6,7,8]

## Parallel-Wave Summary

- Wave 1: Steps 1, 2, and 3 can run concurrently because they establish independent foundations: retry utility, persistent state model, and CLI parsing.
- Wave 2: Steps 4 and 5 can run concurrently after Wave 1. The planner needs state plus flags, while idempotency probing only needs the finalized request/flag surface.
- Wave 3: Step 6 is the integration point and should run alone because it composes retry, state, planning, idempotency, and mode handling into one execution path.
- Wave 4: Steps 7 and 8 can run concurrently after Step 6. Event emission depends on runtime outcome wiring, while task metadata depends on the finalized CLI and behavior surface.
- Wave 5: Step 9 runs last because validation needs the integrated code path, emitted events, and updated task contract in place.
