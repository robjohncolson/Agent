# Step 6: Sync + Scrape Scripts — Accept `--course` and Route Period

## Task
Update two scripts to accept a `--course` argument and route registry writes to the correct period.

## Files to Modify
1. `scripts/sync-schoology-to-registry.mjs`
2. `scripts/scrape-schoology-urls.mjs`

## Part A: `scripts/sync-schoology-to-registry.mjs`

### 1. Add `--course` CLI support

The script currently has no CLI argument parsing. Add basic arg parsing at the top after imports:

```javascript
// Parse CLI args
const cliArgs = process.argv.slice(2);
let coursePeriod = 'B';
for (let i = 0; i < cliArgs.length; i++) {
  if (cliArgs[i] === '--course') {
    coursePeriod = cliArgs[++i] || 'B';
  }
}
```

### 2. Update the COURSE_ID and COURSE_BASE

BEFORE (hardcoded):
```javascript
const COURSE_ID = '7945275782';
const COURSE_BASE = `https://lynnschools.schoology.com/course/${COURSE_ID}`;
```

AFTER:
```javascript
import { COURSE_IDS } from './lib/schoology-dom.mjs';
const COURSE_ID = COURSE_IDS[coursePeriod] || COURSE_IDS.B;
const COURSE_BASE = `https://lynnschools.schoology.com/course/${COURSE_ID}`;
```

### 3. Update the scrape path based on period

Add awareness of which tree file to load. The default is `schoology-materials.json` but ideally it should note the period:

```javascript
console.log(`Syncing Schoology materials for Period ${coursePeriod}...`);
```

### 4. Route `schoologyFolder` URL key by period

In the patch building (around line 131-136), route the URL key:

BEFORE:
```javascript
const patch = {
  topic: `Topic ${unit}.${lesson}`,
  urls: {
    schoologyFolder
  },
```

AFTER:
```javascript
const folderUrlKey = coursePeriod === 'E' ? 'schoologyFolderE' : 'schoologyFolder';
const patch = {
  topic: `Topic ${unit}.${lesson}`,
  urls: {
    [folderUrlKey]: schoologyFolder
  },
```

### 5. Import setSchoologyState if not already imported

Check existing imports. The file imports `loadRegistry, upsertLesson, saveRegistry`. The `schoology` field in the patch object is set directly via `upsertLesson()`. Since `upsertLesson` does a deepMerge, the schoology data needs to be structured in the new per-period format.

Update the schoology patch to use the period key:

BEFORE:
```javascript
schoology: {
  materials: materials.map(m => ({ ... })),
  folderIds,
  dayFolders: [...data.dayFolderTitles],
  ...schoologyUrls,
  schoologyVideos: videos
}
```

AFTER:
```javascript
schoology: {
  [coursePeriod]: {
    materials: materials.map(m => ({ ... })),
    folderIds,
    dayFolders: [...data.dayFolderTitles],
    ...schoologyUrls,
    schoologyVideos: videos
  }
}
```

## Part B: `scripts/scrape-schoology-urls.mjs`

### 1. Add `--course` CLI argument

Update the `parseArgs()` function to accept `--course`:

Add to the arg parsing loop:
```javascript
if (arg === "--course") {
  const next = args[i + 1];
  if (!next) {
    console.error("Missing value for --course.");
    printUsage(1);
  }
  opts.coursePeriod = next;
  i += 1;
  continue;
}
```

And add `coursePeriod: 'B'` to the initial opts, return it.

### 2. Route URL key by period

In `applyRegistryUpdate()`, use the correct URL key for the folder:

BEFORE (line ~346):
```javascript
if (folderUrl) {
  updateUrl(unit, lesson, "schoologyFolder", folderUrl);
}
```

AFTER:
```javascript
if (folderUrl) {
  const folderUrlKey = opts.coursePeriod === 'E' ? 'schoologyFolderE' : 'schoologyFolder';
  updateUrl(unit, lesson, folderUrlKey, folderUrl);
}
```

Note: `applyRegistryUpdate` needs access to the period. The simplest approach is to add a `coursePeriod` field to the update object parameter, or pass it as a module-level variable.

Since `applyRegistryUpdate` is a standalone function, add `coursePeriod` to its parameter object:

```javascript
function applyRegistryUpdate({ dryRun, unit, lesson, folderTitle, folderUrl, urlType, lessonUrl, coursePeriod = 'B' }) {
```

Then update all callers to pass `coursePeriod: opts.coursePeriod`.

### 3. Update course URL default

Currently `DEFAULT_COURSE_URL` is hardcoded. Add period-aware URL selection:

```javascript
import { COURSE_IDS } from './lib/schoology-dom.mjs';
```

In `main()`, after parsing args:
```javascript
const courseId = COURSE_IDS[opts.coursePeriod] || COURSE_IDS.B;
const defaultUrl = `https://lynnschools.schoology.com/course/${courseId}/materials`;
const materialsRootUrl = opts.courseUrl !== DEFAULT_COURSE_URL
  ? toMaterialsRootUrl(opts.courseUrl)
  : defaultUrl;
```

### 4. Update console output

```javascript
console.log(`Scraping Schoology materials from Period ${opts.coursePeriod}...`);
```

## Constraints
- Default period is `'B'` for both scripts
- Do NOT change the scraping/DOM logic
- Do NOT change the tree traversal logic in sync script
- Both scripts should print which period they're operating on
- The `--course` flag takes a period letter (B or E), NOT a course ID
