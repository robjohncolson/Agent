# Step 2.7 + 3.2: Update batch-copy-to-period-e.mjs (Hash + Staleness)

## Task
Update `scripts/batch-copy-to-period-e.mjs` to:
1. Skip stale materials instead of trying to copy them (prevents 30s CDP timeouts)
2. Use content hash for "already exists in E" detection instead of `copiedFromId`

## File to Modify
`scripts/batch-copy-to-period-e.mjs`

## Changes

### 1. Skip stale materials in the keyed materials loop
When building the list of materials to copy, skip any B material marked stale:

```javascript
for (const type of MATERIAL_TYPES) {
  if (onlyType && type !== onlyType) continue;
  if (!bMats[type]?.schoologyId) continue;

  // NEW: skip stale materials
  if (bMats[type]?.stale === true) {
    console.log(`  [skip-stale] ${key} ${type}: stale since last scrape`);
    continue;
  }

  // Use contentHash for "already exists" check
  if (bMats[type]?.contentHash && eMats[type]?.contentHash === bMats[type]?.contentHash) {
    continue; // Already exists in E with matching content
  }

  if (eMats[type]?.schoologyId || eMats[type]?.copiedFromId) continue;
  missing.push(type);
}
```

### 2. Filter stale videos
When building the list of B videos to copy, filter out stale ones:

```javascript
const bVids = Array.isArray(bMats.videos)
  ? bMats.videos.filter(v => v.schoologyId && v.stale !== true)  // NEW: filter stale
  : [];
```

### 3. Use content hash for video "already exists" check
When checking if a B video already exists in E, use contentHash matching:

```javascript
const eVidHashes = new Set(
  (Array.isArray(eMats.videos) ? eMats.videos : [])
    .map(v => v.contentHash)
    .filter(Boolean)
);

for (const v of bVids) {
  // Skip if E already has this content (by hash)
  if (v.contentHash && eVidHashes.has(v.contentHash)) continue;
  // Fall back to copiedFromId/schoologyId check for unhashed materials
  // ... existing logic ...
  missingVids.push(v);
}
```

### Important
- Use `=== true` for stale checks (absent `stale` field = not stale)
- Keep the existing `copiedFromId`/`schoologyId` fallback for materials that don't have contentHash yet (backward compatibility during rollout)
- Log `[skip-stale]` messages so the user knows why materials were skipped

## Verification
```bash
node --check scripts/batch-copy-to-period-e.mjs
```
Must exit 0.
