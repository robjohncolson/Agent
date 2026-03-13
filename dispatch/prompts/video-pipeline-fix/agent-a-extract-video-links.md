# Agent A: Extract loadVideoLinks to shared lib + backfill registry

## Task

1. **Extract** the `loadVideoLinks` function from `scripts/post-to-schoology.mjs` (lines 265-306) into a new shared module `scripts/lib/load-video-links.mjs`.
2. **Modify** `scripts/post-to-schoology.mjs` to import from the shared module instead of using the inline function. Keep the `UNITS_JS_PATH` constant definition in the poster file and pass it as an argument, OR move it to paths.mjs.
3. **Create** `scripts/backfill-video-urls.mjs` — a script that reads ALL topics from `units.js`, calls `loadVideoLinks(unit, lesson)` for each, and writes the results to `state/lesson-registry.json` under `registry[key].urls.apVideos`.

## File Ownership

You may ONLY modify these files:
- `scripts/lib/load-video-links.mjs` (create)
- `scripts/backfill-video-urls.mjs` (create)
- `scripts/post-to-schoology.mjs` (modify lines 258-306 region ONLY)

Do NOT touch: `scripts/build-roadmap-data.mjs`, `scripts/lesson-prep.mjs`, or any other files.

## Context

### Current `loadVideoLinks` in post-to-schoology.mjs (lines 265-306):

```javascript
function loadVideoLinks(unit, lesson) {
  if (!existsSync(UNITS_JS_PATH)) {
    console.warn(`  WARNING: ${UNITS_JS_PATH} not found. Skipping video links.`);
    return [];
  }
  const content = readFileSync(UNITS_JS_PATH, "utf-8");
  const lessonId = `${unit}-${lesson}`;
  const idIndex = content.indexOf(`id: "${lessonId}"`);
  if (idIndex === -1) {
    console.warn(`  WARNING: Lesson ${lessonId} not found in units.js. Skipping video links.`);
    return [];
  }
  const afterId = content.substring(idIndex, idIndex + 500);
  const descMatch = afterId.match(/description:\s*"([^"]+)"/);
  const description = descMatch ? descMatch[1] : "";
  const nextIdIndex = content.indexOf(`id: "`, idIndex + 10);
  const lessonBlock = nextIdIndex !== -1
    ? content.substring(idIndex, nextIdIndex)
    : content.substring(idIndex, idIndex + 1000);
  const urls = [];
  const urlRegex = /url:\s*"(https:\/\/apclassroom\.collegeboard\.org\/[^"]+)"/g;
  let m;
  while ((m = urlRegex.exec(lessonBlock)) !== null) {
    urls.push(m[1]);
  }
  return urls.map((url, i) => ({
    key: `video${i + 1}`,
    url,
    title: urls.length === 1
      ? `Topic ${unit}.${lesson} — AP Classroom Video`
      : `Topic ${unit}.${lesson} — AP Classroom Video ${i + 1}`,
  }));
}
```

### UNITS_JS_PATH (defined at top of post-to-schoology.mjs):

```javascript
const UNITS_JS_PATH = "C:/Users/ColsonR/curriculum_render/data/units.js";
```

### Registry schema for urls field:

```json
"urls": {
  "worksheet": "https://...",
  "drills": "https://...",
  "quiz": "https://...",
  "blooket": "https://...",
  "videos": ["driveId1"],
  "apVideos": []  // ← NEW: array of {url, title} from AP Classroom
}
```

### paths.mjs pattern (used by other shared libs):

```javascript
import { join } from "node:path";
export const AGENT_ROOT = "C:/Users/ColsonR/Agent";
export const WORKSHEET_REPO = "C:/Users/ColsonR/apstats-live-worksheet";
```

## Backfill script requirements

`scripts/backfill-video-urls.mjs`:

1. Read `state/lesson-registry.json`
2. For each lesson key (format "X.Y"), call `loadVideoLinks(unit, lesson)`
3. Set `registry[key].urls.apVideos = result` (the array of `{key, url, title}` objects)
4. Write the updated registry back
5. Support `--dry-run` flag (print what would be written, don't modify registry)
6. Print summary: "Updated N lessons with AP Classroom video URLs"

## Acceptance

- `node scripts/backfill-video-urls.mjs --dry-run` works
- `node scripts/backfill-video-urls.mjs` updates registry
- `scripts/post-to-schoology.mjs` still works identically after refactor
