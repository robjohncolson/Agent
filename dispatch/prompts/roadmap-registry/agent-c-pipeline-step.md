# Agent C: Add Pipeline Step

## Task
Add an optional `build-roadmap` step to `pipelines/lesson-prep.json`.

## Owned File
- `pipelines/lesson-prep.json` (MODIFY)

## Change
Add this entry after the `export-registry` step:
```json
{ "task": "build-roadmap", "depends_on": ["export-registry"], "defined": false, "optional": true }
```

The step runs after the registry is finalized. It's marked `optional: true` so pipeline
failures in this step don't block the lesson prep workflow. Marked `defined: false` until
a task definition is created.

## Acceptance Criteria
- New step appears after `export-registry` and before `commit-push`
- Has `"optional": true` flag
- `commit-push` step's `depends_on` remains unchanged (still depends on `export-registry`)
