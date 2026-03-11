# Step 2.4: Auto-compute contentHash in updateSchoologyMaterial()

## Task
Make `updateSchoologyMaterial()` in `scripts/lib/lesson-registry.mjs` automatically compute and set `contentHash` on every material write.

## File to Modify
`scripts/lib/lesson-registry.mjs`

## Dependencies
- `scripts/lib/content-hash.mjs` must exist (Step 2.1)
- Validation is already wired in (Step 1.4)

## Changes

### 1. Add import
Add to the existing imports at top of file:
```javascript
import { computeContentHash, normalizeTitle } from './content-hash.mjs';
```

### 2. Auto-compute hash in `updateSchoologyMaterial()`
After validation passes but BEFORE the material is written to the registry, compute and inject the contentHash.

For **array data** (videos):
```javascript
if (Array.isArray(materialData)) {
  // Auto-compute contentHash for each video
  for (let i = 0; i < materialData.length; i++) {
    const v = materialData[i];
    if (v && typeof v === 'object' && !v.contentHash) {
      const disambig = v.targetUrl || normalizeTitle(v.title) || `untitled-${i}`;
      v.contentHash = computeContentHash(unitNum, lessonNum, 'video', disambig);
    }
  }
  registry[key].schoology[period].materials[type] = materialData;
}
```

For **keyed materials** (worksheet, drills, quiz, blooket):
```javascript
else {
  // Auto-compute contentHash for keyed material
  if (!materialData.contentHash) {
    materialData.contentHash = computeContentHash(unitNum, lessonNum, type);
  }
  registry[key].schoology[period].materials[type] = {
    ...(registry[key].schoology[period].materials[type] || {}),
    ...materialData,
  };
}
```

### Important
- Only set `contentHash` if it's not already present (don't overwrite explicit hashes)
- The hash computation happens AFTER validation so the validator sees the data as-is
- Videos use `targetUrl` as disambiguator, falling back to normalized title, then `"untitled-{index}"`

## Verification
```bash
node --check scripts/lib/lesson-registry.mjs
```
Must exit 0. After this change, any material written via `updateSchoologyMaterial()` will automatically get a `contentHash` if one isn't already set.
