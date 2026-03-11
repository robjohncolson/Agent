# Step 1: Extract Classification Helpers

## Task
Extract `parseTopicFromTitle()` and `classifyMaterial()` from `scripts/sync-schoology-to-registry.mjs` into a new shared module `scripts/lib/schoology-classify.mjs`, then update the sync script to import from the new module.

## Create: `scripts/lib/schoology-classify.mjs`

Export the following functions (copy from `sync-schoology-to-registry.mjs`):

### `parseTopicFromTitle(title)`
- Extract unit.lesson from a material title string
- Support patterns: `Topic X.Y`, `Quiz X.Y`, `Unit X Lesson Y`, `uXlY`, `apstats X-Y`, `X-Y`, `X.Y`
- Reject multi-lesson titles (e.g., `L{10,11}`)
- Return `{ unit: number, lesson: number, isQuiz?: boolean }` or `null`

### `classifyMaterial(title)`
- Classify a Schoology material title into a type
- Types: `worksheet`, `drills`, `blooket`, `quiz`, `video`, `context`, `meta`, `unknown`
- Match patterns:
  - worksheet: /worksheet|follow.?along/i
  - drills: /drill/i
  - blooket: /blooket/i
  - quiz: /quiz/i
  - video: /video|apclassroom/i
  - context: /context|summary/i
  - meta: /calendar|folder/i
- Return the type string

## Modify: `scripts/sync-schoology-to-registry.mjs`
- Remove the inline `parseTopicFromTitle()` and `classifyMaterial()` functions
- Add: `import { parseTopicFromTitle, classifyMaterial } from './lib/schoology-classify.mjs';`
- Verify all existing behavior is preserved (the functions should be exact copies)

## Constraints
- Do NOT modify any function logic — pure extraction
- Preserve the original function's JSDoc comments
- Ensure both CommonJS-style and ES module imports work (the file uses `import` syntax)

## Verification
```bash
node -c scripts/lib/schoology-classify.mjs
node -c scripts/sync-schoology-to-registry.mjs
# Quick smoke test:
node -e "import { parseTopicFromTitle, classifyMaterial } from './scripts/lib/schoology-classify.mjs'; console.log(parseTopicFromTitle('Topic 6.10 — Worksheet')); console.log(classifyMaterial('Topic 6.10 — Follow-Along Worksheet'));"
```

Expected output:
```
{ unit: 6, lesson: 10 }
worksheet
```
