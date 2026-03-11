# Step 2.6 + 3.3: Update catch-up-diff.mjs (Hash + Staleness)

## Task
Update `scripts/lib/catch-up-diff.mjs` to:
1. Use content hash instead of `copiedFromId` lineage for B/E compliance checks
2. Factor staleness into the `isActionComplete('post-schoology-E')` check

## File to Modify
`scripts/lib/catch-up-diff.mjs`

## Changes

### 1. Hash-based B/E compliance in `isActionComplete('post-schoology-E')`

Replace the current `copiedFromId`-based lineage check with content hash comparison.

**For keyed materials** (worksheet, drills, quiz, blooket):

BEFORE (fragile — breaks on re-post):
```javascript
if (bMats[type]?.schoologyId && !eMats[type]?.schoologyId && !eMats[type]?.copiedFromId) {
  return false;
}
```

AFTER (stable — survives re-post):
```javascript
if (bMats[type]?.contentHash && !eMats[type]?.contentHash) {
  return false; // B has it, E doesn't
}
```

**For videos:**

BEFORE:
```javascript
const eVidIds = new Set(eVids.map(v => v.copiedFromId || v.schoologyId).filter(Boolean));
for (const v of bVids) {
  if (!eVidIds.has(v.schoologyId)) return false;
}
```

AFTER:
```javascript
const eVidHashes = new Set(eVids.map(v => v.contentHash).filter(Boolean));
for (const v of bVids) {
  if (v.contentHash && !eVidHashes.has(v.contentHash)) return false;
}
```

### 2. Staleness check in `isActionComplete('post-schoology-E')`

Add a staleness check BEFORE the hash-based compliance check. If any B material is stale, the lesson needs a re-scrape before copy can proceed:

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

  // Hash-based compliance: every B material must have a matching E material
  for (const type of ['worksheet', 'drills', 'quiz', 'blooket']) {
    if (bMats[type]?.contentHash && !eMats[type]?.contentHash) return false;
  }
  const eVids = Array.isArray(eMats.videos) ? eMats.videos : [];
  const eVidHashes = new Set(eVids.map(v => v.contentHash).filter(Boolean));
  for (const v of bVids) {
    if (v.contentHash && !eVidHashes.has(v.contentHash)) return false;
  }

  return true;
}
```

### Important
- Use `=== true` for staleness checks (materials without `stale` field are treated as non-stale)
- `contentHash` comparison is null-safe: only check if B material HAS a contentHash
- Keep any other existing logic in the `post-schoology-E` case that isn't related to material comparison

## Verification
```bash
node --check scripts/lib/catch-up-diff.mjs
```
Must exit 0.
