# Step 2: Deep Recursive Schoology Scraper

## Task
Create `scripts/schoology-deep-scrape.mjs` — a CDP-based recursive scraper that builds a complete, normalized map of every folder and material in a Schoology course.

## Depends On
- Step 1: `scripts/lib/schoology-classify.mjs` (must exist)
- Existing: `scripts/lib/cdp-connect.mjs`, `scripts/lib/schoology-dom.mjs`

## Create: `scripts/schoology-deep-scrape.mjs`

### CLI Interface
```bash
node scripts/schoology-deep-scrape.mjs                           # Full scrape, Period B
node scripts/schoology-deep-scrape.mjs --course E                # Period E
node scripts/schoology-deep-scrape.mjs --folder 986721319        # Subtree only
node scripts/schoology-deep-scrape.mjs --output custom-path.json # Custom output
```

### Imports
```javascript
import { connectCDP } from './lib/cdp-connect.mjs';
import { navigateToFolder, listItems, COURSE_IDS, materialsUrl } from './lib/schoology-dom.mjs';
import { parseTopicFromTitle, classifyMaterial } from './lib/schoology-classify.mjs';
```

### Algorithm
1. Connect to Edge via CDP (`connectCDP()`)
2. Navigate to course materials root (`navigateToFolder(page, courseId, startFolderId)`)
3. Call `listItems(page)` to get folders and materials at current level
4. For each folder: recursively enter it, scrape, come back up
5. For each material: classify it, extract target URL if possible
6. Build three output structures:
   - `folders` — flat Map keyed by folder ID
   - `materials` — flat Map keyed by material ID (schoologyId)
   - `lessonIndex` — reverse index keyed by "unit.lesson"

### Key Data Structures

**Folder entry:**
```json
{
  "id": "986721319",
  "title": "Topic 6.10",
  "path": ["Q3", "week 24", "Monday 3/16/26"],
  "parentId": "986588515",
  "depth": 3,
  "children": ["986721320"],
  "materials": ["8285243425", "8285243838"]
}
```

**Material entry:**
```json
{
  "id": "8285243425",
  "title": "Topic 6.10 — Follow-Along Worksheet",
  "type": "link",
  "href": "https://lynnschools.schoology.com/course/.../link/view/8285243425",
  "targetUrl": "https://robjohncolson.github.io/...",
  "folderId": "986721319",
  "folderPath": ["Q3", "week 24", "Monday 3/16/26", "Topic 6.10"],
  "parsedLesson": { "unit": 6, "lesson": 10 },
  "parsedType": "worksheet"
}
```

**lessonIndex entry:**
```json
{
  "folders": ["986721319"],
  "materials": ["8285243425", "8285243838", "8285244776"],
  "primaryFolder": "986721319",
  "folderPath": ["Q3", "week 24", "Monday 3/16/26", "Topic 6.10"]
}
```

### Target URL Extraction
For materials of type "link", try to extract the actual destination URL:
1. The `href` from `listItems()` gives the Schoology view URL (e.g., `/course/.../link/view/8285243425`)
2. If the href contains redirect params (`url=`, `target=`, `u=`, `link=`), extract the target
3. Otherwise store `targetUrl: null` — the view URL is still useful for reconciliation

Reference implementation for URL unwrapping: see `unwrapSchoologyLink()` in `scripts/scrape-schoology-urls.mjs` (lines 157-184).

### Recursion Pattern
```javascript
async function scrapeFolder(page, courseId, folderId, parentId, path, depth, folders, materials) {
  // Navigate to folder
  await navigateToFolder(page, courseId, folderId);
  await sleep(1500); // Navigation delay

  // List items at this level
  const items = await listItems(page);

  // Process folders (recurse) and materials (classify + store)
  for (const item of items) {
    if (item.type === 'folder') {
      const childPath = [...path, item.name];
      folders[item.id] = {
        id: item.id, title: item.name, path: childPath,
        parentId, depth, children: [], materials: []
      };
      if (parentId) folders[parentId].children.push(item.id);
      await scrapeFolder(page, courseId, item.id, item.id, childPath, depth + 1, folders, materials);
    } else {
      // Classify material
      const parsed = parseTopicFromTitle(item.name);
      const matType = classifyMaterial(item.name);
      const matId = item.id;
      materials[matId] = {
        id: matId, title: item.name, type: item.type,
        href: item.href, targetUrl: null, // TODO: extract
        folderId: folderId || '__root__',
        folderPath: folderId ? [...path] : [],
        parsedLesson: parsed, parsedType: matType
      };
      if (folderId && folders[folderId]) {
        folders[folderId].materials.push(matId);
      }
    }
  }
}
```

### Building lessonIndex
After scraping completes, iterate all materials and group by parsed lesson:
```javascript
const lessonIndex = {};
for (const [matId, mat] of Object.entries(materials)) {
  if (!mat.parsedLesson) continue;
  const key = `${mat.parsedLesson.unit}.${mat.parsedLesson.lesson}`;
  if (!lessonIndex[key]) {
    lessonIndex[key] = { folders: [], materials: [], primaryFolder: null, folderPath: null };
  }
  lessonIndex[key].materials.push(matId);
  if (mat.folderId && mat.folderId !== '__root__' && !lessonIndex[key].folders.includes(mat.folderId)) {
    lessonIndex[key].folders.push(mat.folderId);
    if (!lessonIndex[key].primaryFolder) {
      lessonIndex[key].primaryFolder = mat.folderId;
      lessonIndex[key].folderPath = mat.folderPath;
    }
  }
}
```

### Output
Write to `state/schoology-tree.json` (or custom path via `--output`).

### Error Handling
- If CDP connection fails, exit with clear error message
- If a folder navigation fails (timeout), log warning and skip that subtree
- Print progress: `Scraping folder: Q3/week 24 (depth 2, 15 items)...`
- Print summary at end: total folders, materials, max depth, elapsed time

## Constraints
- Use ES module syntax (`import`/`export`)
- Navigation delay: 1500ms between folder navigations (Schoology rate limiting)
- Maximum depth safety: 10 levels (warn if exceeded)
- Use `process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0'` for corporate proxy

## Verification
```bash
node -c scripts/schoology-deep-scrape.mjs
# Full test requires Edge with CDP on port 9222 and active Schoology session
```
