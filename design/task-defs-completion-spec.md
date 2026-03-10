# Task Definitions Completion Spec

## Goal
Create the 9 remaining task JSON files in `tasks/` and update `pipelines/lesson-prep.json` to mark all steps `"defined": true`.

## Schema Reference
All task files follow `schema/task.schema.json`. Required fields: `id`, `name`, `type`, `worker`.

## Existing Examples (3 defined)
- `tasks/ingest.json` — type: `cdp-browser`, worker: `scripts/aistudio-ingest.mjs`
- `tasks/content-gen-worksheet.json` — type: `codex-agent`, worker: `codex`
- `tasks/render-animations.json` — type: `node-script`, worker: `scripts/render-animations.mjs`

## Task Definitions to Create

### 1. `tasks/content-gen-blooket.json`
- **type**: `codex-agent`
- **worker**: `codex`
- **name**: "Generate Blooket quiz CSV via Codex"
- **inputs**: `unit` ({{unit}}), `lesson` ({{lesson}}), `video_context_dir` ("u{{unit}}")
- **outputs**: files: `u{{unit}}_l{{lesson}}_blooket.csv`, registry_key: `blooket_csv`
- **preconditions**: registry_status key `blooket_csv` not `done`
- **on_failure**: strategy `fail`
- **timeout_minutes**: 15

### 2. `tasks/content-gen-drills.json`
- **type**: `codex-agent`
- **worker**: `codex`
- **name**: "Generate drill cartridge definitions via Codex"
- **inputs**: `unit` ({{unit}}), `lesson` ({{lesson}}), `video_context_dir` ("u{{unit}}")
- **outputs**: registry_key: `drills`
- **preconditions**: registry_status key `drills` not `done`
- **on_failure**: strategy `fail`
- **timeout_minutes**: 15

### 3. `tasks/upload-animations.json`
- **type**: `node-script`
- **worker**: `scripts/upload-animations.mjs`
- **name**: "Upload rendered animations to Supabase"
- **inputs**: `unit` ({{unit}}), `lesson` ({{lesson}})
- **outputs**: registry_key: `animation_urls`
- **preconditions**: registry_status key `animation_urls` not `done`
- **on_failure**: strategy `skip` (non-blocking)
- **timeout_minutes**: 10

### 4. `tasks/upload-blooket.json`
- **type**: `cdp-browser`
- **worker**: `scripts/upload-blooket.mjs`
- **name**: "Upload Blooket CSV via CDP"
- **inputs**: `unit` ({{unit}}), `lesson` ({{lesson}})
- **outputs**: registry_key: `blooket_url`
- **preconditions**: requires_cdp: true, registry_status key `blooket_url` not `done`
- **on_failure**: strategy `skip` (non-blocking)
- **timeout_minutes**: 10

### 5. `tasks/schoology-post.json`
- **type**: `cdp-browser`
- **worker**: `scripts/post-to-schoology.mjs`
- **name**: "Post lesson materials to Schoology"
- **inputs**: `unit` ({{unit}}), `lesson` ({{lesson}}), `blooket_url` ({{blooket_url}}), `auto_urls` (true)
- **outputs**: registry_key: `schoology`
- **preconditions**: requires_cdp: true, registry_status key `schoology` not `done`
- **on_failure**: strategy `skip` (non-blocking)
- **timeout_minutes**: 15

### 6. `tasks/verify-schoology.json`
- **type**: `node-script`
- **worker**: `scripts/schoology-verify.mjs`
- **name**: "Verify Schoology links are live"
- **inputs**: `unit` ({{unit}}), `lesson` ({{lesson}})
- **outputs**: registry_key: `schoology_verified`
- **preconditions**: registry_status key `schoology_verified` not `done`
- **on_failure**: strategy `skip` (informational only)
- **timeout_minutes**: 5

### 7. `tasks/generate-urls.json`
- **type**: `node-script`
- **worker**: `scripts/lesson-urls.mjs`
- **name**: "Generate and print lesson URLs"
- **inputs**: `unit` ({{unit}}), `lesson` ({{lesson}})
- **outputs**: registry_key: `urls_generated`
- **preconditions**: registry_status key `urls_generated` not `done`
- **on_failure**: strategy `skip`
- **timeout_minutes**: 2

### 8. `tasks/export-registry.json`
- **type**: `node-script`
- **worker**: `scripts/export-registry.mjs`
- **name**: "Export lesson registry to worksheet repo"
- **inputs**: (none — reads state/lesson-registry.json internally)
- **outputs**: registry_key: `registry_exported`
- **preconditions**: registry_status key `registry_exported` not `done`
- **on_failure**: strategy `skip`
- **timeout_minutes**: 2

### 9. `tasks/commit-push.json`
- **type**: `git-operation`
- **worker**: `scripts/lesson-prep.mjs`
- **name**: "Commit and push all downstream repos"
- **inputs**: `unit` ({{unit}}), `lesson` ({{lesson}}), `auto_push` (true)
- **outputs**: registry_key: `committed`
- **preconditions**: registry_status key `committed` not `done`
- **on_failure**: strategy `fail`
- **timeout_minutes**: 5

## Pipeline Update
After all 9 task files are created, update `pipelines/lesson-prep.json`:
- Set `"defined": true` on all 9 steps that currently have `"defined": false`

## Validation
- Each JSON file must validate against `schema/task.schema.json`
- All `id` values must match the `task` references in `pipelines/lesson-prep.json`
- Worker paths must point to existing scripts (except `codex` which is a CLI tool)

## Files Changed
- 9 new files: `tasks/*.json`
- 1 modified file: `pipelines/lesson-prep.json`
