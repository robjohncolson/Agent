# Step 5: Poster — Period-Aware Posting

## Task
Update `scripts/post-to-schoology.mjs` to detect the period from the course ID and route `setSchoologyState()` / `updateSchoologyMaterial()` / `updateUrl()` calls to the correct period.

## Files to Modify
- `scripts/post-to-schoology.mjs` (ONLY this file)

## Changes

### 1. Add period detection from course ID

Add a helper function near the top of the file (after CONFIG):

```javascript
import { COURSE_IDS } from './lib/schoology-dom.mjs';

function detectPeriod(courseId) {
  if (courseId === COURSE_IDS.E || courseId === 'E') return 'E';
  return 'B';
}
```

Note: `COURSE_IDS` is already exported from `schoology-dom.mjs` with values `{ B: '7945275782', E: '7945275798' }`.

### 2. Detect period in main()

In `main()`, after `const { unit, lesson, courseId, dryRun, autoUrls } = opts;` (around line 474), add:

```javascript
const period = detectPeriod(courseId);
const folderUrlKey = period === 'E' ? 'schoologyFolderE' : 'schoologyFolder';
```

### 3. Update `updateUrl()` calls to use correct URL key

Every call to `updateUrl(unit, lesson, "schoologyFolder", ...)` should use `folderUrlKey` instead:

There are several places where `updateUrl(unit, lesson, "schoologyFolder", ...)` is called:
- Line ~656: heal mode discovery
- Line ~676: folder-path + create-folder mode
- Line ~698: folder-path mode (no create-folder)
- Line ~713: create-folder mode

Replace ALL of these with:
```javascript
updateUrl(unit, lesson, folderUrlKey, materialsUrl);
```

### 4. Update `setSchoologyState()` calls to pass period

Every call to `setSchoologyState(unit, lesson, { ... })` should pass `period` as the 4th argument:

- Line ~678: folder-path + create-folder
- Line ~694-699: folder-path (no create-folder)
- Line ~715-720: create-folder

Change all to:
```javascript
setSchoologyState(unit, lesson, { ... }, period);
```

### 5. Update `updateSchoologyMaterial()` calls to pass period

Every call to `updateSchoologyMaterial(unit, lesson, ...)` should pass `period` as the 5th argument:

- Line ~848: successful post
- Line ~872: failed post

Change to:
```javascript
updateSchoologyMaterial(unit, lesson, link.key, { ... }, period);
```

### 6. Heal mode: use period-aware URL key

In heal mode (around line 641-644), when reading the folder URL from registry:
```javascript
// BEFORE
if (regEntry?.urls?.schoologyFolder) {
  materialsUrl = regEntry.urls.schoologyFolder;
// AFTER
if (regEntry?.urls?.[folderUrlKey]) {
  materialsUrl = regEntry.urls[folderUrlKey];
```

### 7. Add COURSE_IDS import

Add `COURSE_IDS` to the import from `schoology-dom.mjs`. There's no existing import from schoology-dom.mjs in this file, but the module is available. Check if there's already an import. The file currently imports from `schoology-heal.mjs`. Add a new import line:

```javascript
import { COURSE_IDS } from './lib/schoology-dom.mjs';
```

## Constraints
- Default period is `'B'` — when courseId matches period B (or is unrecognized), use `'B'`
- Do NOT change CDP posting logic (postLink, createFolder, extractFolderUrl)
- Do NOT change URL generation logic (buildAutoUrls, buildLinkTitles)
- Do NOT change the --course CLI arg parsing — it already accepts course IDs
- The `period` variable must be derived from the `courseId` that's already being parsed
