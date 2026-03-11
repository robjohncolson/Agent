# Multi-Period Registry — Spec

**Goal**: Make the lesson registry period-aware so each lesson tracks Schoology state independently for Period B and Period E (and any future periods), without breaking existing single-period workflows.

**Status**: SPEC — ready for implementation

---

## Problem Statement

The lesson registry (`state/lesson-registry.json`) stores one `schoology` object per lesson:

```json
"schoology": {
  "folderId": "985937488",
  "folderPath": "Q3/week 23/Thursday 3/5/26",
  "folderTitle": "Thursday 3/5/26",
  "verifiedAt": null,
  "reconciledAt": null,
  "materials": { "worksheet": {...}, "drills": {...}, ... }
}
```

This assumes a single Schoology course. Period B (7945275782) and Period E (7945275798) are separate courses with different folder IDs, folder names, and material IDs for the same lessons. Running the reconciler against Period E produces 42 `wrong_folder` errors because every folder ID in the registry belongs to Period B.

Additionally, `urls.schoologyFolder` stores Period B's folder URL. `urls.schoologyFolderE` exists as a key but is never populated.

Period E also needs folder name standardization (52+ inconsistent folder names like `"Friday(September 26th, 2025) apstat"`, `"WEDNESDAY NOV 12 2025"`, `"We4dnesday 2//26"`).

---

## Current State

### Period B (complete)
- 52/52 folders renamed to `{DayOfWeek} {M/D/YY}` format
- 4 orphans repaired
- Fresh scrape: 96 folders, 273 materials, 47 lessons
- Reconciliation: 5 errors (3 registry pointer mismatches + 2 stale orphan refs)

### Period E (scraped, not yet cleaned)
- Fresh scrape: 86 folders, 225 materials, 46 lessons
- 0 orphans at root (clean)
- Reconciliation: 42 `wrong_folder` errors (all registry → B folder IDs)
- Folder names: wildly inconsistent, need standardization
- Backfill was done via `scripts/schoology-backfill.mjs` — work-ahead folders exist for weeks 24-26

---

## Design

### Registry Shape Change

```json
// BEFORE — single-period (B only)
"schoology": {
  "folderId": "985937488",
  "folderPath": "Q3/week 23/Thursday 3/5/26",
  "folderTitle": "Thursday 3/5/26",
  "verifiedAt": null,
  "reconciledAt": null,
  "materials": { ... }
}

// AFTER — per-period map
"schoology": {
  "B": {
    "folderId": "985937488",
    "folderPath": "Q3/week 23/Thursday 3/5/26",
    "folderTitle": "Thursday 3/5/26",
    "verifiedAt": null,
    "reconciledAt": null,
    "materials": { ... }
  },
  "E": {
    "folderId": "986478123",
    "folderPath": "Q3/week 23/friday 3/5/26",
    "folderTitle": "friday 3/5/26",
    "verifiedAt": null,
    "reconciledAt": null,
    "materials": { ... }
  }
}
```

Each period key contains the same shape as the old flat `schoology` object. The period letter matches the course key used elsewhere (`COURSE_IDS` in `schoology-dom.mjs`).

### URL Keys

No change to the URL layer — keep the existing pattern:
- `urls.schoologyFolder` — Period B folder URL
- `urls.schoologyFolderE` — Period E folder URL

Both already exist in `URL_KEYS`. The `updateUrl()` function already validates both.

---

## Implementation

### Step 1: Registry API — Add `period` parameter

**File**: `scripts/lib/lesson-registry.mjs`

Add an optional `period` parameter (default `'B'`) to all schoology-related functions:

```javascript
// BEFORE
export function getSchoologyState(unit, lesson) { ... }
export function setSchoologyState(unit, lesson, state) { ... }
export function updateSchoologyMaterial(unit, lesson, type, data) { ... }

// AFTER
export function getSchoologyState(unit, lesson, period = 'B') { ... }
export function setSchoologyState(unit, lesson, state, period = 'B') { ... }
export function updateSchoologyMaterial(unit, lesson, type, data, period = 'B') { ... }
```

**Internal logic change**: These functions access `registry[key].schoology[period]` instead of `registry[key].schoology`.

**Auto-detection of old format**: If `registry[key].schoology.folderId` exists (flat format), treat it as Period B data. This makes the migration non-destructive — old entries work before the data migration runs.

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

**`createDefaultEntry()`**: Change the `schoology` default to an empty object `{}` (the per-period sub-objects are created on first write).

### Step 2: Data migration script

**File**: `scripts/migrate-registry-multi-period.mjs`

One-time migration that converts all existing flat `schoology` objects to `{ B: {...} }`:

```bash
node scripts/migrate-registry-multi-period.mjs              # Preview
node scripts/migrate-registry-multi-period.mjs --execute     # Apply
```

**Algorithm**:
1. Load `state/lesson-registry.json`
2. For each entry with `schoology.folderId` (old flat format):
   - Wrap the entire `schoology` object as `{ B: <old object> }`
3. Leave entries that are already in new format (have period keys) untouched
4. Save and back up the old file to `state/lesson-registry.pre-multiperiod.json`

**Detection heuristic**: If `schoology` has a `folderId` property → old flat format. If it has single-letter keys whose values are objects with `folderId` → new format. If empty → skip.

### Step 3: Reconciler — Period-aware matching

**File**: `scripts/lib/schoology-reconcile.mjs`

The reconciler already receives the tree (which contains `meta.courseId` and `meta.coursePeriod`). It needs to:

1. Detect the period from `tree.meta.coursePeriod` (already set by the scraper)
2. Read `schoology[period]` instead of `schoology` for each lesson
3. Compare folder IDs against the correct period's data

**Changes**:
- `reconcileLesson(entry, lessonIndex, tree)` → add `period` parameter derived from tree metadata
- All `entry.schoology.folderId` reads become `entry.schoology?.[period]?.folderId`
- `urls.schoologyFolder` lookup becomes period-conditional: `urls.schoologyFolder` for B, `urls.schoologyFolderE` for E

**File**: `scripts/schoology-reconcile.mjs` (CLI)

- Extract period from tree metadata (already loaded)
- Pass period to reconciler
- `--fix` mode writes to the correct period key via `setSchoologyState(u, l, state, period)`

### Step 4: Orphan repair — Period-aware lookup

**File**: `scripts/schoology-repair-orphans.mjs`

- Read period from `tree.meta.coursePeriod` (line 247 already does `tree.meta?.courseId`)
- Look up `schoology[period].folderId` when finding target folders for orphans
- The tree path already has the correct tree, so folder matching works — only the registry lookup changes

### Step 5: Poster — Period-aware posting

**File**: `scripts/post-to-schoology.mjs`

- Detect period from the `--course` arg or from the course ID being posted to
- Route `updateUrl()` calls to `schoologyFolder` (B) or `schoologyFolderE` (E)
- Route `setSchoologyState()` / `updateSchoologyMaterial()` calls with the detected period
- Already has `COURSE_IDS` import from `schoology-dom.mjs`

### Step 6: Sync + scrape scripts

**File**: `scripts/sync-schoology-to-registry.mjs`
- Accept `--course` arg (currently hardcoded to B)
- Pass period letter to `setSchoologyState()` calls

**File**: `scripts/scrape-schoology-urls.mjs`
- Accept `--course` arg
- Write to `schoologyFolder` or `schoologyFolderE` accordingly

### Step 7: Period E folder standardization

After the registry migration is in place, run the existing rename pipeline against Period E:

```bash
node scripts/schoology-rename-folders.mjs --course E --ai           # Preview
node scripts/schoology-rename-folders.mjs --course E --ai --execute  # Apply
```

Then re-scrape and reconcile:
```bash
node scripts/schoology-deep-scrape.mjs --course E --ai
node scripts/schoology-reconcile.mjs
```

---

## Dependency Graph

```
Step 1 (registry API)
  │
  ├──→ Step 2 (data migration)  ─── run once ───→  Step 7 (E folder renames)
  │
  ├──→ Step 3 (reconciler)
  │
  ├──→ Step 4 (orphan repair)
  │
  ├──→ Step 5 (poster)
  │
  └──→ Step 6 (sync + scrape)
```

Step 1 is the foundation — all others depend on it. Steps 2-6 are independent of each other after Step 1 lands. Step 7 is operational (not code) and happens after Steps 1-3 are in place.

---

## Backward Compatibility Guarantees

1. **Default `period='B'`** — all existing callers work without modification
2. **Auto-detect old format** — `resolveSchoologyPeriod()` handles flat objects transparently
3. **URL keys unchanged** — `schoologyFolder` (B) and `schoologyFolderE` (E) already exist
4. **CLI defaults unchanged** — all `--course` flags default to `B`
5. **Pipeline unaffected** — `lesson-prep.mjs` calls registry functions with no period arg → defaults to B
6. **Migration is reversible** — backup saved to `state/lesson-registry.pre-multiperiod.json`

---

## Consumer Inventory (9 files)

| # | File | Reads | Writes | Change Needed |
|---|------|-------|--------|---------------|
| 1 | `scripts/lib/lesson-registry.mjs` | `schoology.*` | `schoology.*` | Add `period` param to 3 functions + auto-detect |
| 2 | `scripts/post-to-schoology.mjs` | `urls.schoologyFolder`, `schoology.*` | `urls.schoologyFolder`, `schoology.*` | Route by period |
| 3 | `scripts/migrate-registry-schoology.mjs` | old format | new format | N/A (superseded by Step 2 migration) |
| 4 | `scripts/sync-schoology-to-registry.mjs` | tree | `schoology.*` | Accept `--course`, pass period |
| 5 | `scripts/lib/schoology-reconcile.mjs` | `schoology.folderId` | — | Read `schoology[period]` |
| 6 | `scripts/schoology-reconcile.mjs` | tree, registry | `schoology.*` via fix | Pass period from tree metadata |
| 7 | `scripts/schoology-repair-orphans.mjs` | `schoology.folderId` | — | Read `schoology[period]` from tree metadata |
| 8 | `scripts/scrape-schoology-urls.mjs` | — | `urls.schoologyFolder` | Accept `--course`, route URL key |
| 9 | `scripts/lesson-prep.mjs` | `getSchoologyLinks()` (deprecated) | — | No change (defaults to B) |

---

## Success Criteria

1. `node scripts/schoology-reconcile.mjs` (using Period B tree) produces same results as before migration
2. `node scripts/schoology-deep-scrape.mjs --course E --ai && node scripts/schoology-reconcile.mjs` correctly reads Period E's folder IDs and produces meaningful results (not 42 wrong_folder errors)
3. `node scripts/schoology-rename-folders.mjs --course E --ai --execute` standardizes Period E folder names
4. `node scripts/lesson-prep.mjs --auto` works unchanged (defaults to B)
5. Registry entries show both `schoology.B` and `schoology.E` after both periods are scraped
6. All existing tests pass (if any)

---

## Constants

```
Period B course ID: 7945275782
Period E course ID: 7945275798
Registry path:     state/lesson-registry.json
Tree path:         state/schoology-tree.json (overwritten per scrape)
Backup path:       state/lesson-registry.pre-multiperiod.json
```
