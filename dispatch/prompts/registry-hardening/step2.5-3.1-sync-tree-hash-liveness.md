# Step 2.5 + 3.1: Update sync-tree-to-registry.mjs (Hash + Liveness)

## Task
Update `scripts/sync-tree-to-registry.mjs` to:
1. Compute `contentHash` for incoming materials during sync
2. Set `lastSeenAt` and `stale` fields on materials (liveness tracking)

## File to Modify
`scripts/sync-tree-to-registry.mjs`

## Dependencies
- `scripts/lib/content-hash.mjs` must exist (Step 2.1)

## Changes

### 1. Add import
```javascript
import { computeContentHash, normalizeTitle } from './lib/content-hash.mjs';
```

### 2. Content Hash on incoming materials
When syncing a tree material to the registry (both IDs-only and full mode), compute and set the contentHash:

For **keyed materials** (worksheet, drills, quiz, blooket):
```javascript
materialData.contentHash = computeContentHash(unit, lesson, type);
```

For **videos**:
```javascript
const disambig = v.targetUrl || normalizeTitle(v.title) || `untitled-${i}`;
v.contentHash = computeContentHash(unit, lesson, 'video', disambig);
```

### 3. Liveness: Set `lastSeenAt` on matched materials
When a registry material matches a tree material (by schoologyId or contentHash), stamp it:

```javascript
material.lastSeenAt = new Date().toISOString();
material.stale = false;
```

### 4. Liveness: Mark unmatched registry materials as stale
After processing all tree materials for a lesson+period, iterate the registry's materials for that lesson+period. Any material with a `schoologyId` that was NOT found in the tree should be marked stale:

```javascript
// Build set of tree material IDs for this lesson
const treeMatIds = new Set();
// ... populate from tree materials

// After processing all matches:
for (const [type, mat] of Object.entries(regMaterials)) {
  if (type === 'videos') {
    if (!Array.isArray(mat)) continue;
    for (const v of mat) {
      if (v.schoologyId && !treeVidIds.has(v.schoologyId)) {
        v.stale = true;
      }
    }
  } else if (mat?.schoologyId && !treeMatTypes.has(type)) {
    mat.stale = true;
  }
}
```

### 5. Content Hash for re-post detection
When matching tree materials to registry materials, also check by contentHash:
- If a tree material has the same content hash as a registry material but a different schoologyId, this is a **re-post**
- Update the schoologyId to the new value, keep the contentHash
- Do NOT create a duplicate entry

## Key Points
- `lastSeenAt` is always an ISO 8601 timestamp string
- `stale` is `true` when not seen, `false` when seen, absent when never checked
- Materials without `schoologyId` are not subject to liveness checks
- This applies to both IDs-only mode (default) and full mode

## Verification
```bash
node --check scripts/sync-tree-to-registry.mjs
```
Must exit 0. After this change, running the sync will populate `contentHash`, `lastSeenAt`, and `stale` on all processed materials.
