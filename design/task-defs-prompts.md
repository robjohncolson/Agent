# Task Definition Implementation Prompts

These prompts are organized by dependency-graph wave from `design/task-defs-dep-graph.md`. Copy each prompt block into a Codex agent as-is. Wave 2 contains four parallel prompts; they can run concurrently after Wave 1 is complete.

## Wave 1

Purpose: lock the exact schema shape, current task ID set, and current pipeline state before any file creation.

````text
Repo root: `C:\Users\ColsonR\Agent`

Read these files and do not modify anything in this wave:
- `design/task-defs-completion-spec.md`
- `design/task-defs-dep-graph.md`
- `schema/task.schema.json`
- `pipelines/lesson-prep.json`
- `tasks/ingest.json`
- `tasks/content-gen-worksheet.json`
- `tasks/render-animations.json`

Task files to write in this wave: none.
Pipeline update in this wave: none.

Exit after you have confirmed:
1. Task files use the schema at `../schema/task.schema.json`.
2. Required task fields are `id`, `name`, `type`, and `worker`.
3. The currently undefined pipeline task IDs are:
   - `content-gen-blooket`
   - `content-gen-drills`
   - `upload-animations`
   - `upload-blooket`
   - `schoology-post`
   - `verify-schoology`
   - `generate-urls`
   - `export-registry`
   - `commit-push`
````

## Wave 2

Purpose: create the nine missing task definitions. The four prompts below are parallel lanes from the dependency graph and can be assigned independently.

### Wave 2A: Codex Agent Tasks

````text
Repo root: `C:\Users\ColsonR\Agent`

Create these files exactly. Do not modify any other files in this wave.

File: `tasks/content-gen-blooket.json`
```json
{
  "$schema": "../schema/task.schema.json",
  "id": "content-gen-blooket",
  "name": "Generate Blooket quiz CSV via Codex",
  "type": "codex-agent",
  "worker": "codex",
  "inputs": {
    "unit": "{{unit}}",
    "lesson": "{{lesson}}",
    "video_context_dir": "u{{unit}}"
  },
  "outputs": {
    "files": "u{{unit}}_l{{lesson}}_blooket.csv",
    "registry_key": "blooket_csv"
  },
  "preconditions": {
    "registry_status": { "key": "blooket_csv", "not": "done" }
  },
  "on_failure": {
    "strategy": "fail"
  },
  "timeout_minutes": 15
}
```

File: `tasks/content-gen-drills.json`
```json
{
  "$schema": "../schema/task.schema.json",
  "id": "content-gen-drills",
  "name": "Generate drill cartridge definitions via Codex",
  "type": "codex-agent",
  "worker": "codex",
  "inputs": {
    "unit": "{{unit}}",
    "lesson": "{{lesson}}",
    "video_context_dir": "u{{unit}}"
  },
  "outputs": {
    "registry_key": "drills"
  },
  "preconditions": {
    "registry_status": { "key": "drills", "not": "done" }
  },
  "on_failure": {
    "strategy": "fail"
  },
  "timeout_minutes": 15
}
```

Pipeline update in this wave: none. Do not edit `pipelines/lesson-prep.json` yet.
````

### Wave 2B: Node Script Tasks

````text
Repo root: `C:\Users\ColsonR\Agent`

Create these files exactly. Do not modify any other files in this wave.

File: `tasks/upload-animations.json`
```json
{
  "$schema": "../schema/task.schema.json",
  "id": "upload-animations",
  "name": "Upload rendered animations to Supabase",
  "type": "node-script",
  "worker": "scripts/upload-animations.mjs",
  "inputs": {
    "unit": "{{unit}}",
    "lesson": "{{lesson}}"
  },
  "outputs": {
    "registry_key": "animation_urls"
  },
  "preconditions": {
    "registry_status": { "key": "animation_urls", "not": "done" }
  },
  "on_failure": {
    "strategy": "skip"
  },
  "timeout_minutes": 10
}
```

File: `tasks/verify-schoology.json`
```json
{
  "$schema": "../schema/task.schema.json",
  "id": "verify-schoology",
  "name": "Verify Schoology links are live",
  "type": "node-script",
  "worker": "scripts/schoology-verify.mjs",
  "inputs": {
    "unit": "{{unit}}",
    "lesson": "{{lesson}}"
  },
  "outputs": {
    "registry_key": "schoology_verified"
  },
  "preconditions": {
    "registry_status": { "key": "schoology_verified", "not": "done" }
  },
  "on_failure": {
    "strategy": "skip"
  },
  "timeout_minutes": 5
}
```

File: `tasks/generate-urls.json`
```json
{
  "$schema": "../schema/task.schema.json",
  "id": "generate-urls",
  "name": "Generate and print lesson URLs",
  "type": "node-script",
  "worker": "scripts/lesson-urls.mjs",
  "inputs": {
    "unit": "{{unit}}",
    "lesson": "{{lesson}}"
  },
  "outputs": {
    "registry_key": "urls_generated"
  },
  "preconditions": {
    "registry_status": { "key": "urls_generated", "not": "done" }
  },
  "on_failure": {
    "strategy": "skip"
  },
  "timeout_minutes": 2
}
```

File: `tasks/export-registry.json`
```json
{
  "$schema": "../schema/task.schema.json",
  "id": "export-registry",
  "name": "Export lesson registry to worksheet repo",
  "type": "node-script",
  "worker": "scripts/export-registry.mjs",
  "inputs": {},
  "outputs": {
    "registry_key": "registry_exported"
  },
  "preconditions": {
    "registry_status": { "key": "registry_exported", "not": "done" }
  },
  "on_failure": {
    "strategy": "skip"
  },
  "timeout_minutes": 2
}
```

Pipeline update in this wave: none. Do not edit `pipelines/lesson-prep.json` yet.
````

### Wave 2C: CDP Browser Tasks

````text
Repo root: `C:\Users\ColsonR\Agent`

Create these files exactly. Do not modify any other files in this wave.

File: `tasks/upload-blooket.json`
```json
{
  "$schema": "../schema/task.schema.json",
  "id": "upload-blooket",
  "name": "Upload Blooket CSV via CDP",
  "type": "cdp-browser",
  "worker": "scripts/upload-blooket.mjs",
  "inputs": {
    "unit": "{{unit}}",
    "lesson": "{{lesson}}"
  },
  "outputs": {
    "registry_key": "blooket_url"
  },
  "preconditions": {
    "requires_cdp": true,
    "registry_status": { "key": "blooket_url", "not": "done" }
  },
  "on_failure": {
    "strategy": "skip"
  },
  "timeout_minutes": 10
}
```

File: `tasks/schoology-post.json`
```json
{
  "$schema": "../schema/task.schema.json",
  "id": "schoology-post",
  "name": "Post lesson materials to Schoology",
  "type": "cdp-browser",
  "worker": "scripts/post-to-schoology.mjs",
  "inputs": {
    "unit": "{{unit}}",
    "lesson": "{{lesson}}",
    "blooket_url": "{{blooket_url}}",
    "auto_urls": true
  },
  "outputs": {
    "registry_key": "schoology"
  },
  "preconditions": {
    "requires_cdp": true,
    "registry_status": { "key": "schoology", "not": "done" }
  },
  "on_failure": {
    "strategy": "skip"
  },
  "timeout_minutes": 15
}
```

Pipeline update in this wave: none. Do not edit `pipelines/lesson-prep.json` yet.
````

### Wave 2D: Git Operation Task

````text
Repo root: `C:\Users\ColsonR\Agent`

Create this file exactly. Do not modify any other files in this wave.

File: `tasks/commit-push.json`
```json
{
  "$schema": "../schema/task.schema.json",
  "id": "commit-push",
  "name": "Commit and push all downstream repos",
  "type": "git-operation",
  "worker": "scripts/lesson-prep.mjs",
  "inputs": {
    "unit": "{{unit}}",
    "lesson": "{{lesson}}",
    "auto_push": true
  },
  "outputs": {
    "registry_key": "committed"
  },
  "preconditions": {
    "registry_status": { "key": "committed", "not": "done" }
  },
  "on_failure": {
    "strategy": "fail"
  },
  "timeout_minutes": 5
}
```

Pipeline update in this wave: none. Do not edit `pipelines/lesson-prep.json` yet.
````

## Wave 3

Purpose: cross-check the nine new task files against the pipeline task IDs and worker paths before touching the pipeline definition.

````text
Repo root: `C:\Users\ColsonR\Agent`

Read and verify these files:
- `pipelines/lesson-prep.json`
- `tasks/content-gen-blooket.json`
- `tasks/content-gen-drills.json`
- `tasks/upload-animations.json`
- `tasks/upload-blooket.json`
- `tasks/schoology-post.json`
- `tasks/verify-schoology.json`
- `tasks/generate-urls.json`
- `tasks/export-registry.json`
- `tasks/commit-push.json`

Task files to write in this wave: none.
Pipeline update in this wave: none.

Verification checklist:
1. Every `id` exactly matches one `task` entry already present in `pipelines/lesson-prep.json`.
2. Every non-`codex` worker path exactly matches an existing script path:
   - `scripts/upload-animations.mjs`
   - `scripts/upload-blooket.mjs`
   - `scripts/post-to-schoology.mjs`
   - `scripts/schoology-verify.mjs`
   - `scripts/lesson-urls.mjs`
   - `scripts/export-registry.mjs`
   - `scripts/lesson-prep.mjs`
3. Each JSON file conforms to `schema/task.schema.json`.
````

## Wave 4

Purpose: update the pipeline after the new task files have been authored and checked.

````text
Repo root: `C:\Users\ColsonR\Agent`

Update `pipelines/lesson-prep.json` to exactly this content and do not modify any task files in this wave:

File: `pipelines/lesson-prep.json`
```json
{
  "$schema": "../schema/pipeline.schema.json",
  "id": "lesson-prep",
  "name": "Full Lesson Prep Pipeline",
  "params": ["unit", "lesson", "drive_ids"],
  "steps": [
    { "task": "ingest", "depends_on": [], "defined": true },
    { "task": "content-gen-worksheet", "depends_on": ["ingest"], "defined": true },
    { "task": "content-gen-blooket", "depends_on": ["ingest"], "defined": true },
    { "task": "content-gen-drills", "depends_on": ["ingest"], "defined": true },
    { "task": "render-animations", "depends_on": ["content-gen-drills"], "defined": true },
    { "task": "upload-animations", "depends_on": ["render-animations"], "defined": true },
    { "task": "upload-blooket", "depends_on": ["content-gen-blooket"], "defined": true },
    { "task": "schoology-post", "depends_on": ["upload-blooket", "content-gen-worksheet"], "defined": true },
    { "task": "verify-schoology", "depends_on": ["schoology-post"], "defined": true },
    { "task": "generate-urls", "depends_on": ["schoology-post", "upload-animations"], "defined": true },
    { "task": "export-registry", "depends_on": ["generate-urls"], "defined": true },
    { "task": "commit-push", "depends_on": ["export-registry"], "defined": true }
  ]
}
```

Pipeline update in this wave: set the nine previously undefined steps to `"defined": true` by replacing the full file content above.
````

## Wave 5

Purpose: final validation of the completed change set.

````text
Repo root: `C:\Users\ColsonR\Agent`

Read and validate:
- `schema/task.schema.json`
- `pipelines/lesson-prep.json`
- `tasks/content-gen-blooket.json`
- `tasks/content-gen-drills.json`
- `tasks/upload-animations.json`
- `tasks/upload-blooket.json`
- `tasks/schoology-post.json`
- `tasks/verify-schoology.json`
- `tasks/generate-urls.json`
- `tasks/export-registry.json`
- `tasks/commit-push.json`

Task files to write in this wave: none.
Pipeline update in this wave: none.

Validation checklist:
1. The final file set is exactly nine new `tasks/*.json` files plus one modified `pipelines/lesson-prep.json`.
2. Each task JSON validates against `schema/task.schema.json`.
3. All nine task IDs match the pipeline `task` references.
4. All nine newly defined pipeline steps now have `"defined": true`.
5. The existing files `tasks/ingest.json`, `tasks/content-gen-worksheet.json`, and `tasks/render-animations.json` remain unchanged.
````
