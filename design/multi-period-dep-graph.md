# Multi-Period Registry — Implementation Dependency Graph

## Wave Structure

```
Wave 1 (sequential — foundation):
  Step 1: Registry API  (scripts/lib/lesson-registry.mjs)

Wave 2 (parallel — all depend only on Step 1):
  Step 2: Data migration script     (scripts/migrate-registry-multi-period.mjs)  [NEW FILE]
  Step 3: Reconciler                (scripts/lib/schoology-reconcile.mjs + scripts/schoology-reconcile.mjs)
  Step 4: Orphan repair             (scripts/schoology-repair-orphans.mjs)
  Step 5: Poster                    (scripts/post-to-schoology.mjs)
  Step 6: Sync + scrape scripts     (scripts/sync-schoology-to-registry.mjs + scripts/scrape-schoology-urls.mjs)

Wave 3 (operational — after Wave 1+2):
  Step 7: Period E folder renames   (CLI commands, no code changes)
```

## Dependency Edges

| Step | Depends On | Reason |
|------|-----------|--------|
| 1    | —         | Foundation: adds `period` param to registry API |
| 2    | 1         | Migration script calls `loadRegistry()` / `saveRegistry()` with new shape |
| 3    | 1         | Reconciler reads `schoology[period]` via registry API |
| 4    | 1         | Orphan repair reads `schoology[period].folderId` |
| 5    | 1         | Poster calls `setSchoologyState(u, l, state, period)` |
| 6    | 1         | Sync/scrape pass period to `setSchoologyState()` / `updateUrl()` |
| 7    | 1, 2, 3   | Operational: needs migrated data + working reconciler |

## Parallelism

Steps 2-6 touch **different files** and have **no cross-dependencies**.
They can all be implemented in parallel after Step 1 lands.

Step 7 is not code — it's running existing CLI commands after deployment.
