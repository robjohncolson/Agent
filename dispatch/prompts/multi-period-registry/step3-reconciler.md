# Step 3: Reconciler — Period-Aware Matching

## Task
Update the reconciler library and CLI to read `schoology[period]` instead of `schoology` directly, deriving the period from the tree metadata.

## Files to Modify
1. `scripts/lib/schoology-reconcile.mjs` (reconciler library)
2. `scripts/schoology-reconcile.mjs` (reconciler CLI)

## Part A: `scripts/lib/schoology-reconcile.mjs`

### Changes to `reconcileLesson()`

The function currently reads `registryEntry.schoology.folderId` and `registryEntry.schoology.folderPath`. It needs to read from the period-specific sub-object instead.

**Add a `period` parameter** (default `'B'`):

Current signature:
```javascript
export function reconcileLesson(unit, lesson, registryEntry, tree)
```

New signature:
```javascript
export function reconcileLesson(unit, lesson, registryEntry, tree, period = 'B')
```

**All reads of `registryEntry.schoology.*` must go through the period key:**

Replace these patterns:
- `registryEntry?.schoology?.folderId` → `registryEntry?.schoology?.[period]?.folderId`
- `registryEntry?.schoology?.folderPath` → `registryEntry?.schoology?.[period]?.folderPath`
- `registryEntry.schoology.folderId` → `registryEntry.schoology?.[period]?.folderId`
- `registryEntry.schoology.folderPath` → `registryEntry.schoology?.[period]?.folderPath`

Specifically update these lines:

1. **Line ~150** (registry folder ID extraction):
```javascript
// BEFORE
if (registryEntry?.schoology?.folderId) {
  registryFolderId = String(registryEntry.schoology.folderId);
}
// AFTER
const schoologyPeriod = registryEntry?.schoology?.[period];
if (schoologyPeriod?.folderId) {
  registryFolderId = String(schoologyPeriod.folderId);
}
```

2. **Line ~191** (folder path mismatch check):
```javascript
// BEFORE
if (registryEntry?.schoology?.folderPath && inTree.folderPath) {
  const regPath = registryEntry.schoology.folderPath;
// AFTER
if (schoologyPeriod?.folderPath && inTree.folderPath) {
  const regPath = schoologyPeriod.folderPath;
```

3. **URL key selection for folder URL validation** (lines ~152-157 and ~160):
The folder URL check should use the period-appropriate URL key:
```javascript
// Determine which URL key to check based on period
const folderUrlKey = period === 'E' ? 'schoologyFolderE' : 'schoologyFolder';
```
Then replace `registryEntry?.urls?.schoologyFolder` with `registryEntry?.urls?.[folderUrlKey]` in both the fallback folder ID extraction (line ~152) and the URL validity check (line ~160).

### Changes to `reconcile()`

The `reconcile()` function needs to accept and pass `period` to `reconcileLesson()`:

Current signature:
```javascript
export function reconcile(registry, tree)
```

New signature:
```javascript
export function reconcile(registry, tree, period = 'B')
```

Inside the function, pass `period` to `reconcileLesson()`:
```javascript
const result = reconcileLesson(unit, lesson, entry, safeTree, period);
```

## Part B: `scripts/schoology-reconcile.mjs` (CLI)

### Extract period from tree metadata

After loading the tree (around line 95-99), extract the period:

```javascript
// Derive period from tree metadata
const period = tree.meta?.coursePeriod || 'B';
console.log(`Period: ${period}`);
```

### Pass period to reconcileLesson and reconcile

In single-lesson mode (line ~119):
```javascript
const result = reconcileLesson(unit, lesson, entry, tree, period);
```

In full mode (line ~135):
```javascript
report = reconcile(registry, tree, period);
```

### Fix mode: pass period to setSchoologyState

In the `--fix` mode switch cases, update `setSchoologyState()` calls to pass `period`:

**`wrong_folder` case** (around line 197):
```javascript
// BEFORE
setSchoologyState(unit, lesson, { ...schoologyState, ... });
// AFTER
setSchoologyState(unit, lesson, { ...schoologyState, ... }, period);
```

Note: `getLesson()` returns the full entry, and the schoologyState should come from `currentState?.schoology?.[period] || {}` instead of `currentState?.schoology || {}`.

**`folder_path_mismatch` case** (around line 231):
Same pattern — read from `currentState?.schoology?.[period] || {}` and write via `setSchoologyState(unit, lesson, state, period)`.

### Fix mode: period-aware URL key for wrong_folder

In the `wrong_folder` fix (around line 180-185), use the correct URL key:
```javascript
const folderUrlKey = period === 'E' ? 'schoologyFolderE' : 'schoologyFolder';
// Use folderUrlKey instead of hardcoded 'schoologyFolder' in updateUrl() calls
updateUrl(unit, lesson, folderUrlKey, fixedUrl);
```

Also when reading the base URL:
```javascript
const entry = registry[issue.lesson];
const currentFolderUrl = entry?.urls?.[folderUrlKey];
const baseUrl = currentFolderUrl ? currentFolderUrl.split('?')[0] : '';
```

## Constraints
- All existing callers that omit `period` must work unchanged (defaults to `'B'`)
- Do NOT modify `detectOrphans()` or `findLessonInTree()` — they don't read registry schoology data
- Do NOT add new imports
- The tree's `meta.coursePeriod` is already set by the deep scraper (values: `'B'` or `'E'`)
