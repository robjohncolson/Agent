This graph covers the implementation work required by `design/task-defs-completion-spec.md`, not the runtime execution order already encoded in `pipelines/lesson-prep.json`.

1. Review `schema/task.schema.json`, `pipelines/lesson-prep.json`, and the three existing task definitions to lock the required field shape, naming pattern, and current task IDs. [depends on: none]
2. Create the two `codex-agent` task files: `tasks/content-gen-blooket.json` and `tasks/content-gen-drills.json`, using the existing Codex task pattern and the spec-provided inputs, outputs, preconditions, failure policy, and timeout values. [depends on: 1]
3. Create the four `node-script` task files: `tasks/upload-animations.json`, `tasks/verify-schoology.json`, `tasks/generate-urls.json`, and `tasks/export-registry.json`, matching the schema and the spec-provided worker paths and behavior. [depends on: 1]
4. Create the two `cdp-browser` task files: `tasks/upload-blooket.json` and `tasks/schoology-post.json`, including `requires_cdp: true` where required by the spec. [depends on: 1]
5. Create `tasks/commit-push.json` as the lone `git-operation` task, matching the schema and the spec-provided `auto_push` input, registry key, failure policy, and timeout. [depends on: 1]
6. Cross-check all nine new task files against `pipelines/lesson-prep.json`: every new file's `id` must match an existing `task` reference, and every non-`codex` `worker` path must resolve to an existing script. [depends on: 2,3,4,5]
7. Update `pipelines/lesson-prep.json` by setting the nine currently undefined steps to `"defined": true`, after the task files they reference have been authored and checked. [depends on: 6]
8. Run final validation on the completed change set: confirm each new task file conforms to `schema/task.schema.json`, confirm the pipeline references now align with the new task files, and confirm the final file set is exactly nine new `tasks/*.json` files plus one modified pipeline file. [depends on: 7]

Parallel-wave summary

- Wave 1: Step 1
- Wave 2: Steps 2, 3, 4, and 5 can run concurrently once the shared schema/pipeline review is done.
- Wave 3: Step 6
- Wave 4: Step 7
- Wave 5: Step 8
