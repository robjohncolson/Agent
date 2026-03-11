# Step 4: Orphan Repair — Period-Aware Lookup

## Task
Update `scripts/schoology-repair-orphans.mjs` to read `schoology[period]` when looking up target folders, deriving the period from the tree metadata.

## Files to Modify
- `scripts/schoology-repair-orphans.mjs` (ONLY this file)

## Changes

### 1. Extract period from tree metadata

After `loadTree()` is called in `main()` (around line 245-247), extract the period:

```javascript
const tree = loadTree();
const registry = loadRegistry();
const period = tree.meta?.coursePeriod || 'B';
const courseId = tree.meta?.courseId || COURSE_IDS.B;
```

### 2. Update `findTargetFolder()` to accept and use `period`

Current signature:
```javascript
function findTargetFolder(unit, lesson, registry, tree)
```

New signature:
```javascript
function findTargetFolder(unit, lesson, registry, tree, period = 'B')
```

**Strategy 1** (registry folderId lookup, around line 113-126):

BEFORE:
```javascript
const regEntry = registry[key];
if (regEntry?.schoology?.folderId) {
  const folderId = String(regEntry.schoology.folderId);
  const folderPath = regEntry.schoology.folderPath || [];
```

AFTER:
```javascript
const regEntry = registry[key];
const schoologyPeriod = regEntry?.schoology?.[period];
if (schoologyPeriod?.folderId) {
  const folderId = String(schoologyPeriod.folderId);
  const folderPath = schoologyPeriod.folderPath || [];
```

**Strategy 3** (URL fallback, around line 136-147) — use the correct URL key:

BEFORE:
```javascript
if (regEntry?.urls?.schoologyFolder) {
  const m = regEntry.urls.schoologyFolder.match(/[?&]f=(\d+)/);
```

AFTER:
```javascript
const folderUrlKey = period === 'E' ? 'schoologyFolderE' : 'schoologyFolder';
if (regEntry?.urls?.[folderUrlKey]) {
  const m = regEntry.urls[folderUrlKey].match(/[?&]f=(\d+)/);
```

### 3. Pass period to findTargetFolder in main()

Update the call in the repair plan building (around line 318):

BEFORE:
```javascript
const target = findTargetFolder(lessonInfo.unit, lessonInfo.lesson, registry, tree);
```

AFTER:
```javascript
const target = findTargetFolder(lessonInfo.unit, lessonInfo.lesson, registry, tree, period);
```

## Constraints
- Default period is `'B'` — existing behavior preserved when tree has no `coursePeriod`
- Do NOT modify CDP move logic (gear menu, move popup, etc.)
- Do NOT modify `detectOrphans()` import or usage (it reads from tree, not registry)
- Do NOT add new imports
- Strategy 2 (tree's lessonIndex) is unchanged — it doesn't read registry schoology data
