# Task Runner Integration — Spec

## Problem

`lesson-prep.mjs` (2096 lines) orchestrates 14 steps with hardcoded inline logic.
`task-runner.mjs` (438 lines) is a generic pipeline engine with topological sort,
parallel waves, and failure strategies — but it's not wired to the actual pipeline.

The pipeline JSON and 12 task definitions exist but are unused.

## Goal

Wire the task runner to execute the lesson-prep pipeline from `pipelines/lesson-prep.json`,
making `lesson-prep.mjs` a thin CLI wrapper that delegates to the task runner.

End state: `node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5 --auto`

## Gap Analysis

### 1. Missing Task Types
- `codex-agent`: Stub exists ("not yet implemented"), but Step 2 has 500+ lines of
  prompt building, Codex spawning, output validation, LLM checks
- Solution: Create `scripts/workers/codex-content-gen.mjs` that encapsulates the
  prompt-build → Codex-launch → validate cycle for a single task

### 2. Registry Preconditions Not Enforced
- Task runner logs preconditions but doesn't actually check the registry
- Solution: Import `getLesson` from lesson-registry.mjs, check `status[key]` before
  executing. Skip if done (unless forced).

### 3. Inter-Step Data Flow
- `blooketUrl` flows from Step 5 → Step 6
- `calendarContext` flows from Step 0 → Step 6
- `driveIds` flows from Step 0.5 → Step 1
- Task runner only passes static `params` — no output propagation
- Solution: Add `pipelineContext` object. After each step, merge outputs into context.
  Template resolution reads from both `params` and `context`.

### 4. Steps Not in Pipeline JSON
- Steps 0, 0.5, 6.5, 7.5, 9 are missing from `pipelines/lesson-prep.json`
- Solution: Add them as task definitions (calendar-detect, drive-lookup,
  verify-schoology, export-registry, print-summary)
- Steps 0 and 0.5 are "pre-pipeline" setup → add as first wave in the pipeline

### 5. Self-Heal & Selective Sub-Task Skip
- Step 2 has registry self-heal and per-sub-task skip (worksheet/blooket/drills)
- This is internal to the codex-content-gen worker, not the task runner's concern
- Solution: Worker handles its own sub-task resume logic

## Architecture

```
run-pipeline.mjs (CLI entry point)
  ├── parseArgs() → params + options
  ├── pre-pipeline setup (calendar detect, drive lookup)
  └── task-runner.runPipeline()
        ├── topoSort() → waves
        ├── for each wave:
        │     for each task (parallel):
        │       ├── checkPreconditions() → skip if done
        │       ├── executeTask()
        │       │     ├── node-script: execSync worker
        │       │     ├── cdp-browser: execSync worker
        │       │     ├── codex-agent: spawn codex with prompt
        │       │     └── git-operation: execSync worker
        │       ├── merge outputs → pipelineContext
        │       └── updateRegistry()
        └── return results
```

## Implementation Phases

### Phase 1: Task Runner Enhancements (this session)
1. **Registry precondition enforcement** — check status before executing
2. **Pipeline context** — output propagation between steps
3. **`codex-agent` execution** — spawn Codex with prompt from a worker script
4. **Force/forceSteps support** — override preconditions

### Phase 2: Worker Scripts
1. **`scripts/workers/codex-content-gen.mjs`** — extracted from Step 2
   - Accepts `--task worksheet|blooket|drills --unit U --lesson L`
   - Handles prompt building, Codex launch, validation internally
   - Exits 0 on success, 1 on failure
2. **Update existing workers** to emit outputs parseable by the task runner
   - e.g., upload-blooket.mjs prints `OUTPUT:blooketUrl=https://...`

### Phase 3: CLI Entry Point
1. **`scripts/run-pipeline.mjs`** — replaces lesson-prep.mjs main()
   - Handles pre-pipeline args (--auto, --date, --skip-*)
   - Calls `runPipeline()` with params and options
   - Prints summary at the end

### Phase 4: Migration
1. lesson-prep.mjs becomes a thin wrapper: `import { runPipeline } from './lib/task-runner.mjs'`
2. Or: deprecated in favor of `run-pipeline.mjs`

## Phase 1 Details (this session)

### 1a. Registry precondition enforcement

In `executeTask()`, before running:

```js
if (task.preconditions?.registry_status) {
  const { key, not: notVal } = task.preconditions.registry_status;
  const entry = getLesson(params.unit, params.lesson);
  const currentStatus = entry?.status?.[key];
  if (notVal && currentStatus === notVal.replace('not:', '')) {
    // Status matches "not" condition — should skip
    // Wait, "not: done" means "only run if NOT done"
    // So if currentStatus === "done", skip
  }
}
```

Actually, the precondition `{ key: "ingest", not: "done" }` means:
"Run this task only when registry status for 'ingest' is NOT 'done'."
So if status IS "done", skip the task.

```js
const { key, not: notVal } = task.preconditions.registry_status;
const entry = getLesson(params.unit, params.lesson);
const status = entry?.status?.[key];
if (status === notVal) {
  // Already done — skip
  return { status: 'skipped', duration_ms: 0, reason: `registry: ${key} = ${status}` };
}
```

### 1b. Pipeline context (output propagation)

Add a `context` Map to `runPipeline()`. After each task completes:
- Parse stdout for `OUTPUT:key=value` lines
- Merge into context
- Template resolution reads from `{ ...params, ...Object.fromEntries(context) }`

### 1c. Force/forceSteps

Pass through from options. Skip precondition check if step is in forceSteps or force=true.

### 1d. Registry update after step

After each step completes/fails, call `updateStatus(unit, lesson, registryKey, status)`.

## Output Protocol

Workers that produce data consumed by downstream steps emit lines:
```
OUTPUT:blooket_url=https://dashboard.blooket.com/set/abc123
OUTPUT:folder_id=987654321
```

The task runner parses these and adds them to the pipeline context.
Template resolution in downstream tasks can reference `{{blooket_url}}`.

## Non-Goals (this session)

- Full extraction of Step 2 into a worker script (Phase 2 — separate session)
- Deprecating lesson-prep.mjs (Phase 4)
- Railway-specific changes
- New task type for "function call" (too coupled)
