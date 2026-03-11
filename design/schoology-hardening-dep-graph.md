# Schoology-Registry Hardening — Dependency Graph

## Implementation Steps

1. **Extract classification helpers** — Move `parseTopicFromTitle()` and `classifyMaterial()` from `sync-schoology-to-registry.mjs` into a new shared module `scripts/lib/schoology-classify.mjs`. `[depends on: none]`

2. **Deep recursive scraper** — Create `scripts/schoology-deep-scrape.mjs` that CDP-crawls the entire course folder tree and outputs `state/schoology-tree.json` with flat lookup maps and a `lessonIndex`. Import classifiers from step 1. `[depends on: 1]`

3. **Registry migration script** — Create `scripts/migrate-registry-schoology.mjs` that converts the three legacy Schoology representations (`urls.schoologyFolder`, `schoology.*`, `schoologyLinks.*`) into the unified format. `[depends on: none]`

4. **Registry API hardening** — Add new functions to `scripts/lib/lesson-registry.mjs`: `setSchoologyState()`, `getSchoologyState()`, `updateSchoologyMaterial()`, folder URL validation in `updateUrl()`. `[depends on: 3]`

5. **Reconciliation library** — Create `scripts/lib/schoology-reconcile.mjs` with pure functions: `reconcile()`, `reconcileLesson()`, `findLessonInTree()`, `detectOrphans()`, `validateFolderUrl()`. `[depends on: 1, 2, 4]`

6. **Reconciliation CLI** — Create `scripts/schoology-reconcile.mjs` CLI wrapper that loads tree + registry, calls `reconcile()`, prints report, supports `--fix` mode. `[depends on: 5]`

7. **Pipeline integration** — Update `post-to-schoology.mjs` to store unified schoology state after posting. Update `lesson-prep.mjs` to run reconciliation as a post-pipeline validation step. `[depends on: 4, 6]`

## Dependency DAG

```
    1 (classify)     3 (migration)
    │                │
    ▼                ▼
    2 (scraper)      4 (registry API)
    │                │
    └──────┬─────────┘
           ▼
         5 (reconcile lib)
           │
           ▼
         6 (reconcile CLI)
           │
           ▼
         7 (pipeline integration)
```

## Parallel Waves

| Wave | Steps | Can Parallelize? |
|------|-------|-----------------|
| Wave 1 | 1 (classify), 3 (migration) | YES — independent |
| Wave 2 | 2 (scraper), 4 (registry API) | YES — 2 depends on 1, 4 depends on 3 |
| Wave 3 | 5 (reconcile lib) | NO — needs 2 + 4 |
| Wave 4 | 6 (reconcile CLI) | NO — needs 5 |
| Wave 5 | 7 (pipeline integration) | NO — needs 4 + 6 |

## Critical Path

1 → 2 → 5 → 6 → 7 (scraper chain)
3 → 4 → 5 → 6 → 7 (registry chain)
