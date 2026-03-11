# Step 4: Registry API Hardening

## Task
Add new functions to `scripts/lib/lesson-registry.mjs` for the unified Schoology data model and add folder URL validation.

## Depends On
- Step 3: Migration script defines the new unified shape

## Modify: `scripts/lib/lesson-registry.mjs`

### 1. Add `schoologyFolderE` to URL_KEYS
```javascript
const URL_KEYS = new Set([
  "worksheet", "drills", "quiz", "blooket",
  "schoologyFolder", "schoologyFolderE",  // ← add this
  "videos"
]);
```

### 2. Add folder URL validation to `updateUrl()`
Before setting a URL, validate it if it's a schoology folder URL:
```javascript
export function updateUrl(unit, lesson, urlKey, urlValue) {
  // ... existing validation ...

  // Reject malformed Schoology folder URLs
  if ((urlKey === 'schoologyFolder' || urlKey === 'schoologyFolderE') && urlValue) {
    const fCount = (urlValue.match(/[?&]f=/g) || []).length;
    if (fCount > 1) {
      // Auto-fix: extract last f= param
      const lastF = urlValue.match(/[?&]f=(\d+)/g).pop();
      const folderId = lastF.replace(/[?&]f=/, '');
      const baseUrl = urlValue.split('?')[0];
      urlValue = `${baseUrl}?f=${folderId}`;
      console.warn(`[registry] Auto-fixed malformed folder URL for ${unit}.${lesson}: extracted f=${folderId}`);
    }
  }

  // ... existing set logic ...
}
```

### 3. New function: `setSchoologyState(unit, lesson, state)`
Set the unified `schoology` object on a lesson entry.
```javascript
/**
 * Set the unified Schoology state for a lesson.
 * @param {number} unit
 * @param {number} lesson
 * @param {object} state - { folderId, folderPath, folderTitle, verifiedAt, reconciledAt, materials }
 */
export function setSchoologyState(unit, lesson, state) {
  const registry = loadRegistry();
  const key = `${unit}.${lesson}`;
  if (!registry[key]) {
    registry[key] = createDefaultEntry(unit, lesson);
  }
  registry[key].schoology = {
    folderId: state.folderId ?? null,
    folderPath: state.folderPath ?? null,
    folderTitle: state.folderTitle ?? null,
    verifiedAt: state.verifiedAt ?? null,
    reconciledAt: state.reconciledAt ?? null,
    materials: state.materials ?? {},
  };
  registry[key].timestamps.lastUpdated = new Date().toISOString();
  saveRegistry(registry);
}
```

### 4. New function: `getSchoologyState(unit, lesson)`
Read the unified schoology object.
```javascript
/**
 * Get the unified Schoology state for a lesson.
 * @returns {object|null} The schoology object or null
 */
export function getSchoologyState(unit, lesson) {
  const entry = getLesson(unit, lesson);
  return entry?.schoology ?? null;
}
```

### 5. New function: `updateSchoologyMaterial(unit, lesson, type, materialData)`
Update a single material within the unified schoology object.
```javascript
/**
 * Update a single Schoology material entry.
 * @param {number} unit
 * @param {number} lesson
 * @param {string} type - 'worksheet', 'drills', 'quiz', 'blooket'
 * @param {object} materialData - { schoologyId, title, href, targetUrl, postedAt, verified, status }
 */
export function updateSchoologyMaterial(unit, lesson, type, materialData) {
  const registry = loadRegistry();
  const key = `${unit}.${lesson}`;
  if (!registry[key]) {
    registry[key] = createDefaultEntry(unit, lesson);
  }
  if (!registry[key].schoology) {
    registry[key].schoology = {
      folderId: null, folderPath: null, folderTitle: null,
      verifiedAt: null, reconciledAt: null, materials: {}
    };
  }
  registry[key].schoology.materials[type] = {
    ...(registry[key].schoology.materials[type] || {}),
    ...materialData,
  };
  registry[key].timestamps.lastUpdated = new Date().toISOString();
  saveRegistry(registry);
}
```

### 6. Update `createDefaultEntry()` to include unified schoology shape
```javascript
function createDefaultEntry(unit, lesson) {
  return {
    unit, lesson,
    topic: null, date: null, period: null,
    urls: { worksheet: null, drills: null, quiz: null, blooket: null, schoologyFolder: null, videos: [] },
    status: {
      ingest: "pending", worksheet: "pending", drills: "pending",
      blooketCsv: "pending", blooketUpload: "pending",
      animations: "pending", animationUpload: "pending",
      schoology: "pending", schoologyVerified: "pending",
      urlsGenerated: "pending", registryExported: "pending", committed: "pending",
    },
    schoology: {
      folderId: null, folderPath: null, folderTitle: null,
      verifiedAt: null, reconciledAt: null, materials: {}
    },
    timestamps: { created: null, lastUpdated: null },
  };
}
```

### 7. Deprecate `updateSchoologyLink()` and `getSchoologyLinks()`
Keep them working for backwards compatibility but log a deprecation warning:
```javascript
export function updateSchoologyLink(unit, lesson, key, data) {
  console.warn('[registry] DEPRECATED: updateSchoologyLink() — use updateSchoologyMaterial() instead');
  // ... existing logic, keep working for now ...
}
```

## Constraints
- Do NOT break existing callers of `updateSchoologyLink()` — deprecate, don't remove
- Keep `loadRegistry()`/`saveRegistry()` unchanged
- All new functions follow existing patterns (load → modify → save)
- Do NOT add new dependencies

## Verification
```bash
node -c scripts/lib/lesson-registry.mjs
# Smoke test new functions:
node -e "
import { setSchoologyState, getSchoologyState, updateSchoologyMaterial } from './scripts/lib/lesson-registry.mjs';
// Read-only test:
const state = getSchoologyState(6, 10);
console.log('Current 6.10 schoology:', JSON.stringify(state, null, 2));
"
```
