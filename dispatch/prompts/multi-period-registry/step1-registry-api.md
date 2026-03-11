# Step 1: Registry API — Add `period` parameter

## Task
Modify `scripts/lib/lesson-registry.mjs` to make the Schoology registry period-aware.

## Files to Modify
- `scripts/lib/lesson-registry.mjs` (ONLY this file)

## Requirements

### 1. Add `resolveSchoologyPeriod()` helper (internal, not exported)

```javascript
function resolveSchoologyPeriod(schoologyObj, period) {
  if (!schoologyObj) return null;
  // New format: keyed by period letter
  if (schoologyObj[period]) return schoologyObj[period];
  // Old format: flat object with folderId at top level (treat as B)
  if (schoologyObj.folderId !== undefined && period === 'B') return schoologyObj;
  return null;
}
```

### 2. Update `getSchoologyState()` — add `period = 'B'` parameter

BEFORE:
```javascript
export function getSchoologyState(unit, lesson) {
  const entry = getLesson(unit, lesson);
  return entry?.schoology ?? null;
}
```

AFTER:
```javascript
export function getSchoologyState(unit, lesson, period = 'B') {
  const entry = getLesson(unit, lesson);
  return resolveSchoologyPeriod(entry?.schoology, period);
}
```

### 3. Update `setSchoologyState()` — add `period = 'B'` parameter

BEFORE: writes directly to `registry[key].schoology = { ... }`

AFTER: writes to `registry[key].schoology[period] = { ... }`

The function must:
- Keep `registry[key].schoology` as an object (the period map)
- Write the state into `registry[key].schoology[period]`
- NOT destroy other period keys (e.g., writing B must not erase E)
- Initialize `registry[key].schoology` as `{}` if it doesn't exist

New signature: `export function setSchoologyState(unit, lesson, state, period = 'B')`

Implementation:
```javascript
export function setSchoologyState(unit, lesson, state, period = 'B') {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");
  const key = lessonKey(unitNum, lessonNum);
  const registry = loadRegistry();
  if (!registry[key]) {
    registry[key] = createDefaultEntry(unitNum, lessonNum);
  }
  if (!registry[key].schoology || typeof registry[key].schoology !== 'object') {
    registry[key].schoology = {};
  }
  registry[key].schoology[period] = {
    folderId: state.folderId ?? null,
    folderPath: state.folderPath ?? null,
    folderTitle: state.folderTitle ?? null,
    verifiedAt: state.verifiedAt ?? null,
    reconciledAt: state.reconciledAt ?? null,
    materials: state.materials ?? {},
  };
  registry[key].timestamps.lastUpdated = nowIso();
  saveRegistry(registry);
}
```

### 4. Update `updateSchoologyMaterial()` — add `period = 'B'` parameter

BEFORE: writes to `registry[key].schoology.materials[type]`

AFTER: writes to `registry[key].schoology[period].materials[type]`

New signature: `export function updateSchoologyMaterial(unit, lesson, type, materialData, period = 'B')`

Implementation:
```javascript
export function updateSchoologyMaterial(unit, lesson, type, materialData, period = 'B') {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");
  const key = lessonKey(unitNum, lessonNum);
  const registry = loadRegistry();
  if (!registry[key]) {
    registry[key] = createDefaultEntry(unitNum, lessonNum);
  }
  if (!registry[key].schoology || typeof registry[key].schoology !== 'object') {
    registry[key].schoology = {};
  }
  if (!registry[key].schoology[period]) {
    registry[key].schoology[period] = {
      folderId: null, folderPath: null, folderTitle: null,
      verifiedAt: null, reconciledAt: null, materials: {}
    };
  }
  registry[key].schoology[period].materials[type] = {
    ...(registry[key].schoology[period].materials[type] || {}),
    ...materialData,
  };
  registry[key].timestamps.lastUpdated = nowIso();
  saveRegistry(registry);
}
```

### 5. Update `createDefaultEntry()` — change schoology default

Change the `schoology` field in `createDefaultEntry()` from the flat object to an empty object `{}`.

BEFORE:
```javascript
schoology: {
  folderId: null,
  folderPath: null,
  folderTitle: null,
  verifiedAt: null,
  reconciledAt: null,
  materials: {},
},
```

AFTER:
```javascript
schoology: {},
```

## Constraints
- All existing callers that omit the `period` param must continue working (defaults to `'B'`)
- The `resolveSchoologyPeriod()` helper handles both old flat format and new per-period format
- Do NOT modify any other files
- Do NOT add imports or exports beyond what's needed
- Do NOT change function signatures for non-schoology functions (getLesson, setLesson, upsertLesson, updateUrl, updateStatus, etc.)
