# Registry Hardening Spec

**Status:** Design
**Date:** 2026-03-11
**Scope:** Content-addressable identity, schema validation, liveness tracking

---

## 1. Overview & Motivation

The lesson registry (`state/lesson-registry.json`) is the single source of truth for
which materials have been posted to Schoology across two course periods (B and E).
Every downstream script — batch copy, catch-up diff, reconciler, posting — reads or
writes the registry. When registry data is wrong, the entire pipeline misbehaves:

| Problem | Symptom | Root cause |
|---|---|---|
| Stale `schoologyId` | Batch copy times out (30s) searching for a DOM element that no longer exists | Material was re-posted with a new ID; registry kept the old one |
| Wrong `folderId` | Reconciler reports `wrong_folder` errors; posted materials land in wrong folder | Folder URL was malformed or registry was never updated after folder moves |
| Array/object corruption | `videos` field becomes `{"0": {...}, "1": {...}}` instead of `[...]` | `updateSchoologyMaterial()` spread an array into an object (patched, but pattern can recur) |
| No liveness signal | Cannot tell if a registry entry is still valid without scraping | No `lastSeenAt` timestamp on materials |
| Duplicate entries | Same material appears twice with old + new `schoologyId` | Partial sync wrote the new ID without removing the old one |
| Fragile B/E compliance | `isActionComplete('post-schoology-E')` depends on `copiedFromId` lineage | If material was re-posted (not copied), lineage breaks |

This spec introduces three features that address these problems:

1. **Content Hash** — content-addressable identity that survives re-posts
2. **Schema Validation** — structural correctness enforced on every write
3. **Liveness Bitmap** — staleness detection from scrape timestamps

All three are additive. They layer onto the existing registry shape without breaking
any current read paths.

---

## 2. Feature 1: Content-Addressable Material Identity (Content Hash)

### 2.1 Problem

Two materials are "the same thing" if they represent the same content in the same
lesson — e.g., the worksheet for unit 6 lesson 7. Today, identity is the Schoology
ID (`schoologyId`), which changes every time a material is deleted and re-posted.
This makes re-post detection impossible, deduplication unreliable, and B/E compliance
checks fragile (they depend on `copiedFromId` lineage that breaks on re-post).

### 2.2 Design

Assign every material a **content hash** — a deterministic fingerprint derived from
stable, content-level attributes that do not change across re-posts.

#### Hash inputs (canonical tuple)

For keyed materials (worksheet, drills, quiz, blooket):

```
(unit, lesson, materialType)
```

For videos (which can have multiple per lesson):

```
(unit, lesson, "video", normalizedTitle OR targetUrl)
```

**Why these inputs?**
- `unit` + `lesson` scope the material to a lesson.
- `materialType` distinguishes worksheet from drills within the same lesson.
- For videos, there can be multiple per lesson, so we need a disambiguator. The
  `targetUrl` (the URL the Schoology link points to, e.g., a Google Drive file ID)
  is the most stable. If unavailable, fall back to normalized title.

#### Normalization rules

For the title-based disambiguator (videos without targetUrl):

1. Convert to lowercase
2. Strip leading/trailing whitespace
3. Remove all punctuation except hyphens and periods
4. Collapse consecutive whitespace to a single space
5. Remove common prefixes: "topic X.Y —", "ap classroom", "unit X lesson Y"

```javascript
function normalizeTitle(title) {
  let t = (title || '').toLowerCase().trim();
  t = t.replace(/[^\w\s.\-]/g, '');       // strip punctuation except . and -
  t = t.replace(/\s+/g, ' ');              // collapse whitespace
  t = t.replace(/^topic\s+\d+\.\d+\s*/i, '');
  t = t.replace(/^ap\s*classroom\s*/i, '');
  t = t.replace(/^unit\s*\d+\s*(?:lesson|l)\s*\d+\s*/i, '');
  return t.trim();
}
```

#### Hash algorithm

SHA-256 truncated to 12 hex characters (48 bits of entropy — collision probability
negligible for <1000 materials).

```javascript
import { createHash } from 'node:crypto';

function computeContentHash(unit, lesson, materialType, disambiguator = null) {
  const parts = [String(unit), String(lesson), materialType];
  if (disambiguator) parts.push(disambiguator);
  const input = parts.join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}
```

#### Examples

| Material | Hash input | contentHash |
|---|---|---|
| 6.7 worksheet | `"6\|7\|worksheet"` | `a3f2c8d91e04` |
| 6.7 drills | `"6\|7\|drills"` | `7b1e4f0a2c33` |
| 6.7 video "AP Classroom Video 1" | `"6\|7\|video\|video 1"` | `e9d3a5b18c72` |
| 6.7 video (targetUrl known) | `"6\|7\|video\|https://drive.google.com/...xyz"` | `1f8c2e5d0b77` |

### 2.3 Data Model Changes

Add `contentHash` field to every material object in `schoology[period].materials`:

```jsonc
// Keyed material (before)
"worksheet": {
  "schoologyId": "8285243425",
  "title": "Topic 6.7 — Follow-Along Worksheet",
  "href": "...",
  "targetUrl": null
}

// Keyed material (after)
"worksheet": {
  "contentHash": "a3f2c8d91e04",    // NEW
  "schoologyId": "8285243425",
  "title": "Topic 6.7 — Follow-Along Worksheet",
  "href": "...",
  "targetUrl": null
}

// Video array element (after)
{
  "contentHash": "e9d3a5b18c72",    // NEW
  "schoologyId": "8285245328",
  "title": "Topic 6.7 — AP Classroom Video 1",
  "href": "...",
  "targetUrl": null
}
```

### 2.4 Behavioral Changes

#### Re-post detection

When `updateSchoologyMaterial()` or `sync-tree-to-registry.mjs` writes a material:

1. Compute the content hash for the incoming material.
2. Search the existing materials in the same lesson+period for a matching hash.
3. If found with a **different** `schoologyId` → this is a **re-post**. Update the
   `schoologyId` (and `previousId`, `syncedAt`), keep the hash. Do NOT create a
   duplicate entry.
4. If found with the **same** `schoologyId` → no-op (idempotent).
5. If not found → new material, insert with hash.

#### Deduplication guard

Before writing a material, check for hash collisions within the same lesson+period.
If a material with the same content hash already exists, reject the write (or merge)
instead of creating a duplicate.

```javascript
function findByContentHash(materials, hash) {
  // Check keyed materials
  for (const [type, mat] of Object.entries(materials)) {
    if (type === 'videos') continue;
    if (mat?.contentHash === hash) return { type, material: mat };
  }
  // Check videos array
  const videos = Array.isArray(materials.videos) ? materials.videos : [];
  for (let i = 0; i < videos.length; i++) {
    if (videos[i]?.contentHash === hash) return { type: 'video', index: i, material: videos[i] };
  }
  return null;
}
```

#### B/E compliance (content hash match)

Replace the `copiedFromId` lineage check in `catch-up-diff.mjs` with content hash
comparison:

```javascript
// BEFORE (fragile — breaks on re-post):
if (bMats[type]?.schoologyId && !eMats[type]?.schoologyId && !eMats[type]?.copiedFromId) {
  return false;
}

// AFTER (stable — survives re-post):
if (bMats[type]?.contentHash && !eMats[type]?.contentHash) {
  return false; // B has it, E doesn't
}
// Or: E has a material with the same contentHash = compliant
```

For videos:

```javascript
// BEFORE:
const eVidIds = new Set(eVids.map(v => v.copiedFromId || v.schoologyId).filter(Boolean));
for (const v of bVids) {
  if (!eVidIds.has(v.schoologyId)) return false;
}

// AFTER:
const eVidHashes = new Set(eVids.map(v => v.contentHash).filter(Boolean));
for (const v of bVids) {
  if (v.contentHash && !eVidHashes.has(v.contentHash)) return false;
}
```

### 2.5 Migration

Run a one-time backfill script (`scripts/backfill-content-hashes.mjs`) that:

1. Loads the registry.
2. For every lesson, for every period, for every material: computes and writes
   `contentHash`.
3. Saves the registry.

This is safe because `contentHash` is a new field — no existing code reads it yet.

The backfill script should be idempotent: re-running it overwrites hashes with the
same values.

```javascript
// Pseudocode
const registry = loadRegistry();
for (const [key, entry] of Object.entries(registry)) {
  const { unit, lesson } = entry;
  for (const period of ['B', 'E']) {
    const sch = entry.schoology?.[period];
    if (!sch?.materials) continue;
    for (const [type, mat] of Object.entries(sch.materials)) {
      if (type === 'videos') {
        if (!Array.isArray(mat)) continue;
        for (const v of mat) {
          const disambig = v.targetUrl || normalizeTitle(v.title);
          v.contentHash = computeContentHash(unit, lesson, 'video', disambig);
        }
      } else if (mat && typeof mat === 'object') {
        mat.contentHash = computeContentHash(unit, lesson, type);
      }
    }
  }
}
saveRegistry(registry);
```

---

## 3. Feature 2: Schema Validation on Write

### 3.1 Problem

The registry has no structural validation. Any code path can write malformed data:

- `schoologyId` as a number instead of a string (or as an object)
- `videos` as `{"0": {...}}` instead of `[...]` (the spread-into-object bug)
- `folderId` as `null` when it should be a digit string
- Duplicate `schoologyId` values within the same lesson+period
- Missing required fields

These bugs are silent until a downstream script crashes or produces wrong results.

### 3.2 Design

A `validateMaterial(type, data, context)` function that runs **before every registry
write**. It returns `{ valid: true }` or `{ valid: false, errors: [...] }`.

All existing write functions (`updateSchoologyMaterial`, `setSchoologyState`,
`upsertLesson`) call the validator and throw on failure.

### 3.3 Validation Rules

#### 3.3.1 Material-level rules

| Field | Rule | Error message |
|---|---|---|
| `schoologyId` | Must be a string of digits (`/^\d+$/`) or `null` | `"schoologyId must be a digit string or null, got: {value}"` |
| `contentHash` | Must be a 12-char hex string (`/^[0-9a-f]{12}$/`) or absent | `"contentHash must be 12 hex chars, got: {value}"` |
| `title` | Must be a non-empty string or `null` | `"title must be a string or null"` |
| `href` | Must be a string starting with `https://` or `null` | `"href must be an https URL or null"` |
| `targetUrl` | Must be a string or `null` | `"targetUrl must be a string or null"` |
| `copiedFromId` | Must be a string of digits or absent | `"copiedFromId must be a digit string"` |

#### 3.3.2 Structural rules (per lesson+period)

| Rule | Scope | Error message |
|---|---|---|
| `videos` must be an array | `materials.videos` | `"videos must be an array, got: {typeof}"` |
| `folderId` must be a digit string or null | `schoology[period].folderId` | `"folderId must be a digit string or null"` |
| No duplicate `schoologyId` within same lesson+period | all materials | `"duplicate schoologyId {id} found in {type1} and {type2}"` |
| No duplicate `contentHash` within same lesson+period | all materials | `"duplicate contentHash {hash} found in {type1} and {type2}"` |

#### 3.3.3 Required fields per material type

For keyed materials (worksheet, drills, quiz, blooket), a valid entry is either:
- `null` (material not yet created), OR
- An object with at least one of: `schoologyId`, `copiedFromId`, or `status: "failed"`

An empty object `{}` is invalid for a keyed material — it signals a write went wrong.

### 3.4 Implementation

New file: `scripts/lib/registry-validator.mjs`

```javascript
/**
 * registry-validator.mjs — Schema validation for lesson registry writes.
 *
 * Exports:
 *   validateMaterial(type, data) → { valid, errors }
 *   validateSchoologyState(state, period) → { valid, errors }
 *   validateRegistryEntry(entry) → { valid, errors }
 *   validateEntireRegistry(registry) → { valid, errors, errorCount }
 */

const DIGIT_STRING = /^\d+$/;
const HEX_12 = /^[0-9a-f]{12}$/;
const HTTPS_URL = /^https:\/\//;
const KEYED_TYPES = new Set(['worksheet', 'drills', 'quiz', 'blooket']);

export function validateMaterial(type, data) {
  const errors = [];

  if (data === null || data === undefined) {
    return { valid: true, errors }; // null is valid for "not yet created"
  }

  if (type === 'videos') {
    if (!Array.isArray(data)) {
      errors.push(`videos must be an array, got: ${typeof data}`);
      return { valid: false, errors };
    }
    for (let i = 0; i < data.length; i++) {
      const sub = validateMaterial(`videos[${i}]`, data[i]);
      if (!sub.valid) errors.push(...sub.errors.map(e => `videos[${i}]: ${e}`));
    }
    return { valid: errors.length === 0, errors };
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    errors.push(`${type} must be an object or null, got: ${typeof data}`);
    return { valid: false, errors };
  }

  // Field-level checks
  if ('schoologyId' in data && data.schoologyId !== null) {
    if (typeof data.schoologyId !== 'string' || !DIGIT_STRING.test(data.schoologyId)) {
      errors.push(`schoologyId must be a digit string or null, got: ${JSON.stringify(data.schoologyId)}`);
    }
  }

  if ('contentHash' in data && data.contentHash !== null && data.contentHash !== undefined) {
    if (typeof data.contentHash !== 'string' || !HEX_12.test(data.contentHash)) {
      errors.push(`contentHash must be 12 hex chars, got: ${JSON.stringify(data.contentHash)}`);
    }
  }

  if ('href' in data && data.href !== null) {
    if (typeof data.href !== 'string' || !HTTPS_URL.test(data.href)) {
      errors.push(`href must be an https URL or null, got: ${JSON.stringify(data.href)}`);
    }
  }

  if ('copiedFromId' in data && data.copiedFromId !== null && data.copiedFromId !== undefined) {
    if (typeof data.copiedFromId !== 'string' || !DIGIT_STRING.test(data.copiedFromId)) {
      errors.push(`copiedFromId must be a digit string, got: ${JSON.stringify(data.copiedFromId)}`);
    }
  }

  // Keyed material completeness: must have schoologyId, copiedFromId, or status
  if (KEYED_TYPES.has(type)) {
    const hasId = data.schoologyId || data.copiedFromId;
    const hasStatus = data.status === 'failed' || data.status === 'done';
    if (!hasId && !hasStatus && Object.keys(data).length > 0) {
      errors.push(`${type} must have schoologyId, copiedFromId, or a status — got empty shell`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateSchoologyState(state, period) {
  const errors = [];
  if (!state || typeof state !== 'object') {
    errors.push(`schoology.${period} must be an object`);
    return { valid: false, errors };
  }

  if ('folderId' in state && state.folderId !== null) {
    if (typeof state.folderId !== 'string' || !DIGIT_STRING.test(state.folderId)) {
      errors.push(`folderId must be a digit string or null, got: ${JSON.stringify(state.folderId)}`);
    }
  }

  // Validate materials
  if (state.materials && typeof state.materials === 'object') {
    // Duplicate schoologyId check
    const seenIds = new Map(); // id → type
    for (const [type, mat] of Object.entries(state.materials)) {
      if (type === 'videos' && Array.isArray(mat)) {
        for (const v of mat) {
          if (v?.schoologyId) {
            if (seenIds.has(v.schoologyId)) {
              errors.push(`duplicate schoologyId ${v.schoologyId} in videos and ${seenIds.get(v.schoologyId)}`);
            }
            seenIds.set(v.schoologyId, 'video');
          }
        }
      } else if (mat?.schoologyId) {
        if (seenIds.has(mat.schoologyId)) {
          errors.push(`duplicate schoologyId ${mat.schoologyId} in ${type} and ${seenIds.get(mat.schoologyId)}`);
        }
        seenIds.set(mat.schoologyId, type);
      }
    }

    // Per-material validation
    for (const [type, mat] of Object.entries(state.materials)) {
      const sub = validateMaterial(type, mat);
      if (!sub.valid) errors.push(...sub.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

### 3.5 Integration Points

#### Wrapping `updateSchoologyMaterial()`

In `scripts/lib/lesson-registry.mjs`, add validation before the write:

```javascript
import { validateMaterial, validateSchoologyState } from './registry-validator.mjs';

export function updateSchoologyMaterial(unit, lesson, type, materialData, period = 'B') {
  // --- NEW: validate before write ---
  const validation = validateMaterial(type, materialData);
  if (!validation.valid) {
    const msg = `[registry] Validation failed for ${unit}.${lesson} ${period}.${type}:\n` +
      validation.errors.map(e => `  - ${e}`).join('\n');
    throw new Error(msg);
  }
  // --- existing logic below ---
  // ...
}
```

#### Wrapping `setSchoologyState()`

```javascript
export function setSchoologyState(unit, lesson, state, period = 'B') {
  // --- NEW: validate before write ---
  const validation = validateSchoologyState(state, period);
  if (!validation.valid) {
    const msg = `[registry] Validation failed for ${unit}.${lesson} schoology.${period}:\n` +
      validation.errors.map(e => `  - ${e}`).join('\n');
    throw new Error(msg);
  }
  // --- existing logic below ---
  // ...
}
```

#### CLI `--validate` mode for `schoology-reconcile.mjs`

Add a `--validate` flag that loads the entire registry and runs
`validateRegistryEntry()` on every entry, printing all errors:

```
node scripts/schoology-reconcile.mjs --validate

=== Registry Validation ===

[FAIL] 6.10.B: videos must be an array, got: object
[FAIL] 6.3.E: duplicate schoologyId 8285243425 in worksheet and drills
[OK]   6.7.B: 5 materials valid
[OK]   6.7.E: 4 materials valid
...

Summary: 2 errors in 2 lessons, 18 lessons valid
```

### 3.6 Error Handling Philosophy

- **Writes throw.** A validation failure in `updateSchoologyMaterial()` is a
  programming error that must be fixed immediately. Silent corruption is worse
  than a crash.
- **Callers catch.** Scripts that batch-process (e.g., `sync-tree-to-registry.mjs`)
  should catch validation errors per-material, log them, and continue processing
  remaining materials.
- **`--validate` never throws.** It accumulates all errors and exits with code 1 if
  any are found (for CI/scripting use).

---

## 4. Feature 3: Liveness Bitmap (Staleness Detection)

### 4.1 Problem

The registry has no way to know whether a `schoologyId` is still live in Schoology
without running a full scrape. This causes:

- **Batch copy timeouts:** `batch-copy-to-period-e.mjs` tries to find a DOM element
  for a material that was deleted, waiting 30 seconds before timing out.
- **Phantom compliance:** `catch-up-diff.mjs` marks `post-schoology-E` as complete
  because the registry has a `schoologyId`, but the material was actually deleted.
- **Silent drift:** Materials can be manually deleted in Schoology without the
  registry knowing.

### 4.2 Design

After every scrape, stamp each matched material with `lastSeenAt: ISO timestamp`.
Materials not seen in the latest scrape get flagged `stale: true`. Downstream scripts
check staleness before acting on a material.

#### New fields on material objects

```jsonc
{
  "contentHash": "a3f2c8d91e04",
  "schoologyId": "8285243425",
  "title": "Topic 6.7 — Follow-Along Worksheet",
  "lastSeenAt": "2026-03-11T14:22:02.000Z",   // NEW — set by sync-tree
  "stale": false                                 // NEW — computed from lastSeenAt
}
```

#### Staleness computation

A material is **stale** if:

```javascript
const STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days default

function isStale(material, now = Date.now()) {
  if (!material?.lastSeenAt) return true; // never seen = stale
  const seenAt = new Date(material.lastSeenAt).getTime();
  return (now - seenAt) > STALENESS_THRESHOLD_MS;
}
```

The threshold is configurable via environment variable:

```
STALENESS_THRESHOLD_DAYS=7  # default
```

### 4.3 Data Model Changes

Every material object (both keyed and video array elements) gains two optional
fields:

| Field | Type | Default | Set by |
|---|---|---|---|
| `lastSeenAt` | ISO 8601 string or null | null | `sync-tree-to-registry.mjs` |
| `stale` | boolean | (absent = unknown) | `sync-tree-to-registry.mjs` (on non-match) |

The `stale` field is explicitly set to `false` when a material IS seen in the
scrape, and set to `true` when a material in the registry was NOT found in the
scrape. Materials that have never been through a liveness check have no `stale`
field (treated as "unknown" — downstream scripts treat unknown as non-stale to
avoid false positives during rollout).

### 4.4 Integration Points

#### 4.4.1 `sync-tree-to-registry.mjs` — sets `lastSeenAt`

In the IDs-only sync path (the default mode), after matching a tree material to a
registry material:

```javascript
// When a registry material matches a tree material:
regSch.materials[type].lastSeenAt = new Date().toISOString();
regSch.materials[type].stale = false;

// After processing all tree materials for this lesson,
// mark registry materials NOT found in the tree as stale:
for (const [type, mat] of Object.entries(regSch.materials)) {
  if (type === 'videos') {
    if (!Array.isArray(mat)) continue;
    for (const v of mat) {
      if (v.schoologyId && !treeVidIds.has(v.schoologyId)) {
        v.stale = true;
      }
    }
  } else if (mat?.schoologyId && !treeMats[type]) {
    mat.stale = true;
  }
}
```

In the full-replace mode, all materials come from the tree, so they all get
`lastSeenAt` set and `stale: false`.

#### 4.4.2 `batch-copy-to-period-e.mjs` — skip stale entries

Before adding a material to the copy work list, check staleness:

```javascript
// In the keyed materials loop:
for (const type of MATERIAL_TYPES) {
  if (onlyType && type !== onlyType) continue;
  if (!bMats[type]?.schoologyId) continue;

  // NEW: skip stale materials
  if (bMats[type]?.stale === true) {
    console.log(`  [skip-stale] ${key} ${type}: stale since last scrape`);
    continue;
  }

  if (eMats[type]?.schoologyId || eMats[type]?.copiedFromId) continue;
  missing.push(type);
}

// In the videos loop:
const bVids = Array.isArray(bMats.videos)
  ? bMats.videos.filter(v => v.schoologyId && v.stale !== true)  // NEW: filter stale
  : [];
```

This prevents the 30-second timeout when trying to find deleted materials in the DOM.

#### 4.4.3 `catch-up-diff.mjs` — factor staleness into `isActionComplete()`

In the `post-schoology-E` check, if any B material is stale, the lesson needs a
re-scrape before the copy can proceed:

```javascript
case 'post-schoology-E': {
  if (!schoology.E?.folderId) return false;
  const eMats = schoology.E?.materials || {};
  const bMats = schoology.B?.materials || {};

  // NEW: if any B material is stale, mark as incomplete — needs re-scrape first
  for (const type of ['worksheet', 'drills', 'quiz', 'blooket']) {
    if (bMats[type]?.stale === true) return false;
  }
  const bVids = Array.isArray(bMats.videos) ? bMats.videos : [];
  if (bVids.some(v => v.stale === true)) return false;

  // ... existing compliance logic using contentHash (Feature 1) ...
}
```

#### 4.4.4 `schoology-reconcile.mjs` — report stale materials

Add a new issue type:

```javascript
// In ISSUE_TYPES:
stale_material: 'warning',

// In reconcileLesson(), after material presence checks:
if (schoologyPeriod?.materials) {
  for (const [type, mat] of Object.entries(schoologyPeriod.materials)) {
    if (type === 'videos' && Array.isArray(mat)) {
      for (const v of mat) {
        if (v?.stale === true) {
          issues.push({
            lesson: key,
            severity: 'warning',
            type: 'stale_material',
            detail: `Video "${v.title}" (${v.schoologyId}) marked stale — not seen in last scrape`,
            materialType: 'video',
            schoologyId: v.schoologyId,
          });
        }
      }
    } else if (mat?.stale === true) {
      issues.push({
        lesson: key,
        severity: 'warning',
        type: 'stale_material',
        detail: `${type} (${mat.schoologyId}) marked stale — not seen in last scrape`,
        materialType: type,
        schoologyId: mat.schoologyId,
      });
    }
  }
}
```

### 4.5 Staleness Lifecycle

```
Material posted → registry has schoologyId, no lastSeenAt
        ↓
Scrape runs, material found → lastSeenAt = now, stale = false
        ↓
Next scrape runs, material still there → lastSeenAt = now, stale = false
        ↓
Material deleted from Schoology
        ↓
Next scrape runs, material NOT found → stale = true (lastSeenAt unchanged)
        ↓
Batch copy skips this material
Catch-up diff marks lesson as needing re-scrape
Reconciler warns about stale material
        ↓
Material re-posted (new schoologyId)
        ↓
Scrape runs, matched by contentHash → schoologyId updated, stale = false, lastSeenAt = now
```

---

## 5. Migration Plan

All three features are additive — they add new fields and new validation without
changing existing field semantics. Migration is non-destructive.

### 5.1 Phase 1: Schema Validation (no data changes)

1. Create `scripts/lib/registry-validator.mjs` with all validation functions.
2. Add `--validate` mode to `schoology-reconcile.mjs`.
3. Run `--validate` against current registry to identify existing violations.
4. Fix any existing violations manually.
5. Wire validation into `updateSchoologyMaterial()`, `setSchoologyState()`, and
   `upsertLesson()`.

**Risk:** Low. Validation is read-only until step 5, and step 5 only rejects
invalid future writes.

**Rollback:** Remove the validation calls from the three write functions.

### 5.2 Phase 2: Content Hash (data backfill)

1. Add `computeContentHash()` and `normalizeTitle()` to a new module
   `scripts/lib/content-hash.mjs`.
2. Create `scripts/backfill-content-hashes.mjs` to compute and write hashes for
   all existing materials.
3. Run the backfill.
4. Update `updateSchoologyMaterial()` to auto-compute `contentHash` on write.
5. Update `sync-tree-to-registry.mjs` to compute hashes for incoming materials.
6. Update `catch-up-diff.mjs` to use content hash for B/E compliance.
7. Update `batch-copy-to-period-e.mjs` to use content hash for skip detection.

**Risk:** Medium. The backfill writes new fields but does not modify existing
fields. The behavioral changes in steps 6-7 change compliance logic.

**Rollback:** Content hash fields are ignored by all existing code. Remove the
hash-based comparisons and revert to `copiedFromId` lineage.

### 5.3 Phase 3: Liveness Bitmap (data enrichment)

1. Update `sync-tree-to-registry.mjs` to set `lastSeenAt` and `stale` on
   materials during sync.
2. Update `batch-copy-to-period-e.mjs` to skip stale materials.
3. Update `catch-up-diff.mjs` to factor staleness into `isActionComplete()`.
4. Add `stale_material` issue type to `schoology-reconcile.mjs`.

**Risk:** Low. `lastSeenAt` and `stale` are new fields. Downstream checks use
`=== true` comparisons, so materials without the field are treated as non-stale
(backward compatible).

**Rollback:** Remove staleness checks from downstream scripts. Stale fields in
the registry are harmless.

---

## 6. File Change Manifest

### New Files

| File | Purpose |
|---|---|
| `scripts/lib/registry-validator.mjs` | Schema validation functions |
| `scripts/lib/content-hash.mjs` | Content hash computation + normalization |
| `scripts/backfill-content-hashes.mjs` | One-time migration script |

### Modified Files

| File | Changes |
|---|---|
| `scripts/lib/lesson-registry.mjs` | Import and call validator in `updateSchoologyMaterial()`, `setSchoologyState()`, `upsertLesson()`; auto-compute `contentHash` on material write |
| `scripts/sync-tree-to-registry.mjs` | Compute `contentHash` for incoming materials; set `lastSeenAt`/`stale` on matched/unmatched materials; use content hash for match detection |
| `scripts/batch-copy-to-period-e.mjs` | Skip stale materials; use content hash for "already exists" detection |
| `scripts/lib/catch-up-diff.mjs` | Use content hash for B/E compliance in `isActionComplete('post-schoology-E')`; factor staleness into completion check |
| `scripts/schoology-reconcile.mjs` | Add `--validate` CLI flag; add `stale_material` issue type |
| `scripts/lib/schoology-reconcile.mjs` | Add `stale_material` to `ISSUE_TYPES`; report stale materials in `reconcileLesson()` |
| `scripts/copy-material-to-course.mjs` | Check staleness before attempting copy; use content hash for "already copied" detection |
| `scripts/lib/catch-up-executors.mjs` | No direct changes (calls scripts that change) |

### Unchanged Files

| File | Why unchanged |
|---|---|
| `scripts/lib/schoology-dom.mjs` | DOM helpers are agnostic to registry structure |
| `scripts/lib/schoology-classify.mjs` | Classification logic unchanged |
| `scripts/schoology-deep-scrape.mjs` | Produces the tree; does not touch the registry |
| `state/lesson-registry.json` | Modified by scripts, not by hand (except backfill) |

---

## 7. Implementation Order & Dependency Graph

```
Phase 1: Schema Validation
  Step 1.1: Create registry-validator.mjs
      ↓
  Step 1.2: Add --validate to schoology-reconcile.mjs (CLI wrapper)
      ↓
  Step 1.3: Run --validate, fix existing violations
      ↓
  Step 1.4: Wire validation into lesson-registry.mjs write functions

Phase 2: Content Hash
  Step 2.1: Create content-hash.mjs
      ↓
  Step 2.2: Create backfill-content-hashes.mjs
      ↓
  Step 2.3: Run backfill
      ↓
  Step 2.4: Wire auto-hash into updateSchoologyMaterial()          ← depends on 1.4
      ↓
  Step 2.5: Update sync-tree-to-registry.mjs (hash on incoming)   ← depends on 2.1
      ↓
  Step 2.6: Update catch-up-diff.mjs (hash-based compliance)      ← depends on 2.3
      ↓
  Step 2.7: Update batch-copy-to-period-e.mjs (hash-based skip)   ← depends on 2.3

Phase 3: Liveness Bitmap
  Step 3.1: Update sync-tree-to-registry.mjs (lastSeenAt/stale)   ← depends on 2.5
      ↓
  Step 3.2: Update batch-copy-to-period-e.mjs (skip stale)        ← depends on 2.7
      ↓
  Step 3.3: Update catch-up-diff.mjs (staleness in completion)    ← depends on 2.6
      ↓
  Step 3.4: Add stale_material issue to reconciler                 ← independent
```

### Codex-Dispatchable Steps

Each step below is scoped to be implementable by a single Codex agent invocation
with clear inputs and a verifiable output:

| Step | Files touched | Verification |
|---|---|---|
| 1.1 | `scripts/lib/registry-validator.mjs` (new) | Unit test: validate known-good and known-bad materials |
| 1.2 | `scripts/schoology-reconcile.mjs` | `node scripts/schoology-reconcile.mjs --validate` runs without crash |
| 1.3 | `state/lesson-registry.json` | `--validate` exits 0 |
| 1.4 | `scripts/lib/lesson-registry.mjs` | Writing invalid data throws; writing valid data succeeds |
| 2.1 | `scripts/lib/content-hash.mjs` (new) | `computeContentHash(6, 7, 'worksheet')` returns 12-char hex |
| 2.2 | `scripts/backfill-content-hashes.mjs` (new) | Registry gains `contentHash` on all materials |
| 2.3 | (run script) | Spot-check 3 materials for correct hashes |
| 2.4 | `scripts/lib/lesson-registry.mjs` | `updateSchoologyMaterial()` auto-sets `contentHash` |
| 2.5 | `scripts/sync-tree-to-registry.mjs` | Synced materials have `contentHash` |
| 2.6 | `scripts/lib/catch-up-diff.mjs` | B/E compliance uses `contentHash` |
| 2.7 | `scripts/batch-copy-to-period-e.mjs` | "Already exists" check uses `contentHash` |
| 3.1 | `scripts/sync-tree-to-registry.mjs` | Synced materials have `lastSeenAt`; unmatched get `stale: true` |
| 3.2 | `scripts/batch-copy-to-period-e.mjs` | Stale materials skipped with `[skip-stale]` log |
| 3.3 | `scripts/lib/catch-up-diff.mjs` | Stale B materials → `post-schoology-E` incomplete |
| 3.4 | `scripts/lib/schoology-reconcile.mjs`, `scripts/schoology-reconcile.mjs` | `stale_material` warnings in reconciliation report |

---

## Appendix A: Content Hash Edge Cases

### Quiz assignment offset

Quiz 6.9 tests material from topic 6.9 but is assigned during lesson 6.10. The
content hash is based on the lesson the quiz appears in (6.10), not the topic it
tests (6.9). This matches the registry's existing structure where the quiz URL
lives under the lesson entry where it's assigned.

### Multi-folder lessons

Some lessons span two calendar days (e.g., 6.6 appears in both Monday and Tuesday
folders). The content hash is the same regardless of which folder the material is
in. This is by design — the hash identifies the content, not its location.

### Materials without targetUrl or title

If a video has neither `targetUrl` nor `title`, the disambiguator is
`"untitled-{index}"` where `{index}` is the video's position in the array. This
is a last resort — such materials should be investigated manually.

## Appendix B: Validation Error Recovery

When validation catches an error at write time, the calling script should:

1. **Log the error** with full context (lesson key, period, material type, data).
2. **Continue processing** other materials (do not abort the entire batch).
3. **Report the error** in a summary at the end of the run.
4. **Do not write** the invalid data to the registry.

Example pattern for `sync-tree-to-registry.mjs`:

```javascript
try {
  updateSchoologyMaterial(unit, lesson, type, materialData, period);
  updated++;
} catch (err) {
  if (err.message.includes('Validation failed')) {
    console.error(`  [VALIDATION] ${key} ${type}: ${err.message}`);
    validationErrors++;
  } else {
    throw err; // Re-throw non-validation errors
  }
}
```
