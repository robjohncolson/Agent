# Step 3: Registry Migration Script

## Task
Create `scripts/migrate-registry-schoology.mjs` that converts the three legacy Schoology representations in the lesson registry into a single unified format.

## Depends On
- Nothing (reads existing registry, writes migrated version)

## Context: Current Registry Format (3 competing objects)

### Object 1: `urls.schoologyFolder` (set by posting pipeline)
```json
"urls": {
  "schoologyFolder": "https://lynnschools.schoology.com/course/7945275782/materials?f=986721319"
}
```

### Object 2: `schoology` (set by scraper backfill)
```json
"schoology": {
  "materials": [
    { "title": "Topic 6.10 — Worksheet", "type": "worksheet", "schoologyId": "8285243425", "href": "..." }
  ],
  "folderIds": ["986721319"],
  "dayFolders": ["Monday 3/16/26"],
  "schoologyWorksheet": "https://lynnschools.schoology.com/.../link/view/8285243425",
  "schoologyDrills": "...",
  "schoologyBlooket": "...",
  "schoologyQuiz": "...",
  "schoologyVideos": [...]
}
```

### Object 3: `schoologyLinks` (set by heal mode)
```json
"schoologyLinks": {
  "worksheet": { "status": "done", "postedAt": "ISO8601", "title": "...", "verified": true },
  "drills": { "status": "failed", "error": "...", "attemptedAt": "ISO8601" }
}
```

## Target: Unified Format

```json
"schoology": {
  "folderId": "986721319",
  "folderPath": null,
  "folderTitle": "Monday 3/16/26",
  "verifiedAt": null,
  "reconciledAt": null,
  "materials": {
    "worksheet": {
      "schoologyId": "8285243425",
      "title": "Topic 6.10 — Follow-Along Worksheet",
      "href": "https://lynnschools.schoology.com/.../link/view/8285243425",
      "targetUrl": "https://robjohncolson.github.io/...",
      "postedAt": "ISO8601",
      "verified": true,
      "status": "done"
    },
    "drills": { ... },
    "quiz": { ... },
    "blooket": { ... },
    "videos": []
  }
}
```

## Create: `scripts/migrate-registry-schoology.mjs`

### CLI
```bash
node scripts/migrate-registry-schoology.mjs              # Migrate in place
node scripts/migrate-registry-schoology.mjs --dry-run    # Preview changes
node scripts/migrate-registry-schoology.mjs --backup     # Save backup before migrating
```

### Algorithm

For each entry in the registry:

1. **Extract folderId from `urls.schoologyFolder`**:
   - Parse URL: extract last `f=` param value
   - Handle malformed URLs (double `?f=`): take the LAST `f=` value, log warning
   - Clean the URL in `urls.schoologyFolder` to use single `?f=`
   - If URL is null/empty, folderId = null

2. **Build unified materials object**:
   - Start with empty `{ worksheet: null, drills: null, quiz: null, blooket: null, videos: [] }`
   - **Layer 1** (lowest priority): `schoology.materials[]` array
     - For each material, use `classifyMaterial(title)` to determine type
     - Map to `{ schoologyId, title, href, targetUrl: null }`
   - **Layer 2**: `schoology.schoologyWorksheet/Drills/Quiz/Blooket` URLs
     - Extract schoologyId from URL path (last segment)
     - Merge into corresponding material entry
   - **Layer 3** (highest priority): `schoologyLinks.*`
     - Merge `status`, `postedAt`, `verified`, `error` fields
     - `schoologyLinks.worksheet.title` overrides if present

3. **Extract folderTitle**:
   - From `schoology.dayFolders[0]` if available
   - Otherwise from the topic field or folder name

4. **Build unified `schoology` object**:
   ```javascript
   {
     folderId: extractedFolderId,
     folderPath: null,         // Will be populated by reconciliation (Phase 2)
     folderTitle: extractedTitle,
     verifiedAt: null,
     reconciledAt: null,
     materials: unifiedMaterials
   }
   ```

5. **Remove deprecated fields**:
   - Delete `entry.schoologyLinks`
   - Delete old `entry.schoology` (replaced by new unified one)
   - Keep `urls.schoologyFolder` (cleaned) and `urls.schoologyFolderE`

6. **Fix malformed folder URLs**:
   - `?f=987073311?f=987073401` → `?f=987073401` (keep last)
   - Log each fix

### Import
```javascript
import { loadRegistry, saveRegistry } from './lib/lesson-registry.mjs';
```

Note: Do NOT import `classifyMaterial` from step 1's module — instead inline a simple version or copy it, since step 3 has no dependency on step 1. Use a basic regex classifier:
```javascript
function classifyMaterial(title) {
  if (/worksheet|follow.?along/i.test(title)) return 'worksheet';
  if (/drill/i.test(title)) return 'drills';
  if (/blooket/i.test(title)) return 'blooket';
  if (/quiz/i.test(title)) return 'quiz';
  if (/video|apclassroom/i.test(title)) return 'video';
  return 'unknown';
}
```

### Output
- Print migration report: entries migrated, fields cleaned, warnings
- In `--dry-run` mode: print what would change without writing
- In `--backup` mode: copy `state/lesson-registry.json` to `state/lesson-registry.backup.json` first

## Constraints
- Do NOT delete any data — merge everything into the unified format
- Prefer data from `schoologyLinks` (most recent) over `schoology.materials` (scrape snapshot)
- Handle entries that have none, one, two, or all three of the legacy objects
- Handle entries with no schoology data at all (skip gracefully)

## Verification
```bash
node -c scripts/migrate-registry-schoology.mjs
node scripts/migrate-registry-schoology.mjs --dry-run
# Verify: count entries with old `schoologyLinks` field — should be 0 after migration
node -e "import { loadRegistry } from './scripts/lib/lesson-registry.mjs'; const r = loadRegistry(); const old = Object.values(r).filter(e => e.schoologyLinks); console.log('Entries with legacy schoologyLinks:', old.length);"
```
