# Step 5: Reconciliation Library

## Task
Create `scripts/lib/schoology-reconcile.mjs` — a pure function library (no CDP, no side effects) that compares registry state against the scraped Schoology tree and produces a structured diff report.

## Depends On
- Step 1: `scripts/lib/schoology-classify.mjs` (parseTopicFromTitle)
- Step 2: Deep scraper output format (`state/schoology-tree.json`)
- Step 4: Registry API (`getLesson`, `getSchoologyState`, unified format)

## Create: `scripts/lib/schoology-reconcile.mjs`

### Exported Functions

#### `validateFolderUrl(url)`
```javascript
/**
 * Validate a Schoology folder URL.
 * @param {string} url
 * @returns {{ valid: boolean, folderId?: string, error?: string }}
 */
```
- Check for null/empty → `{ valid: false, error: 'empty' }`
- Check for double `?f=` → `{ valid: false, error: 'malformed_double_f', folderId: lastFId }`
- Check for valid format → `{ valid: true, folderId }`

#### `findLessonInTree(unit, lesson, tree)`
```javascript
/**
 * Find all materials and folders for a lesson in the scraped tree.
 * @param {number} unit
 * @param {number} lesson
 * @param {object} tree - Parsed schoology-tree.json
 * @returns {{ folders: string[], materials: object[], primaryFolder: string|null, folderPath: string[]|null }}
 */
```
- Use `tree.lessonIndex["unit.lesson"]` for O(1) lookup
- If not in index, fall back to scanning `tree.materials` values
- Return all folder IDs, material objects, and the primary folder path

#### `reconcileLesson(unit, lesson, registryEntry, tree)`
```javascript
/**
 * Reconcile a single lesson between registry and Schoology tree.
 * @returns {LessonReport} { status, issues[], materialComparison }
 */
```
Checks performed:
1. **Folder match**: Does registry's `schoologyFolder` folderId match where materials actually are?
2. **Folder URL validity**: Is the folder URL well-formed?
3. **Material presence**: For each expected type (worksheet, drills, quiz, blooket), is there a corresponding material in the tree?
4. **URL target match**: Does the Schoology link point to the same URL as the registry's `urls.worksheet` etc.?
5. **Orphan check**: Are there materials at the course root that belong to this lesson?
6. **Duplicate check**: Is the same material in multiple folders?
7. **Status consistency**: Does `status.schoology` match reality? (e.g., "done" but no materials found)

Issue types:
```javascript
const ISSUE_TYPES = {
  WRONG_FOLDER: { severity: 'error' },
  ORPHANED_AT_ROOT: { severity: 'error' },
  MALFORMED_FOLDER_URL: { severity: 'warning' },
  MISSING_FROM_SCHOOLOGY: { severity: 'error' },
  MISSING_MATERIAL: { severity: 'warning' },
  EXTRA_MATERIAL: { severity: 'info' },
  DUPLICATE_MATERIALS: { severity: 'warning' },
  FOLDER_PATH_MISMATCH: { severity: 'warning' },
  URL_TARGET_MISMATCH: { severity: 'error' },
  STATUS_DRIFT: { severity: 'warning' },
};
```

#### `reconcile(registry, tree)`
```javascript
/**
 * Full reconciliation of all lessons in registry against Schoology tree.
 * @param {object} registry - Full lesson registry (keyed by "unit.lesson")
 * @param {object} tree - Parsed schoology-tree.json
 * @returns {ReconciliationReport}
 */
```
- Iterate all registry entries
- Call `reconcileLesson()` for each
- Also detect orphaned materials not belonging to any lesson
- Build summary statistics

Report structure:
```json
{
  "generatedAt": "ISO8601",
  "summary": {
    "totalLessons": 42,
    "fullyReconciled": 35,
    "withIssues": 5,
    "orphanedInSchoology": 2,
    "missingFromSchoology": 0
  },
  "issues": [
    {
      "lesson": "6.4",
      "severity": "error",
      "type": "wrong_folder",
      "detail": "Registry says folder X but materials found in folder Y",
      "registryFolder": "X",
      "actualFolder": "Y",
      "actualPath": ["Q3", "week 23", "Friday 3/6/26"]
    }
  ],
  "perLesson": {
    "6.10": {
      "status": "reconciled",
      "registryFolder": "986721319",
      "schoologyFolder": "986721319",
      "folderPath": ["Q3", "week 24", "Monday 3/16/26"],
      "expectedMaterials": ["worksheet", "drills", "quiz", "blooket"],
      "foundMaterials": ["worksheet", "drills", "quiz", "blooket"],
      "missing": [],
      "extra": [],
      "issues": []
    }
  }
}
```

#### `detectOrphans(tree)`
```javascript
/**
 * Find materials at the course root level (folderId === '__root__' or null).
 * @returns {{ materialId: string, title: string, parsedLesson: object|null, parsedType: string }[]}
 */
```

### Material Comparison Logic

For each lesson, build "expected" vs "found":

**Expected** (from registry):
- If `urls.worksheet` exists → expect a worksheet material
- If `urls.drills` exists → expect a drills material
- If `urls.quiz` exists → expect a quiz material
- If `urls.blooket` exists → expect a blooket material

**Found** (from tree):
- All materials in `tree.lessonIndex["unit.lesson"]`
- Classify each by `parsedType`

**Comparison**:
- For each expected type, check if a found material of that type exists
- If found: optionally verify `targetUrl` matches `urls[type]`
- If not found: issue `MISSING_MATERIAL`
- For each found material not in expected: issue `EXTRA_MATERIAL`

### Helper: Folder Path Comparison

Registry may store `schoology.folderPath` (after reconciliation populates it).
Tree has `folders[id].path`.
Compare as joined strings: `path.join('/') === expectedPath.join('/')`.

## Constraints
- **Pure functions** — no file I/O, no CDP, no side effects
- All functions take data as arguments, return results
- Do NOT import cdp-connect or schoology-dom
- Import only from `schoology-classify.mjs` and `lesson-registry.mjs` (for type references only)
- Handle null/undefined gracefully throughout

## Verification
```bash
node -c scripts/lib/schoology-reconcile.mjs
# Unit test with synthetic data:
node -e "
import { validateFolderUrl, findLessonInTree, reconcileLesson } from './scripts/lib/schoology-reconcile.mjs';
console.log(validateFolderUrl('https://lynnschools.schoology.com/course/123/materials?f=456'));
console.log(validateFolderUrl('https://lynnschools.schoology.com/course/123/materials?f=456?f=789'));
console.log(validateFolderUrl(null));
"
```

Expected:
```
{ valid: true, folderId: '456' }
{ valid: false, error: 'malformed_double_f', folderId: '789' }
{ valid: false, error: 'empty' }
```
