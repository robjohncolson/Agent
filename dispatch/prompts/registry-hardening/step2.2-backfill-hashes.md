# Step 2.2: Create backfill-content-hashes.mjs

## Task
Create `scripts/backfill-content-hashes.mjs` — a one-time migration script that computes and writes `contentHash` for all existing materials in the registry.

## File to Create
`scripts/backfill-content-hashes.mjs`

## Dependencies
- `scripts/lib/content-hash.mjs` must exist (created in Step 2.1)

## Behavior

1. Load the registry via `loadRegistry()` from `scripts/lib/lesson-registry.mjs`.
2. Iterate every lesson entry.
3. For each period (B, E), for each material:
   - For keyed materials (worksheet, drills, quiz, blooket): compute `contentHash = computeContentHash(unit, lesson, type)`
   - For videos: compute `contentHash = computeContentHash(unit, lesson, 'video', disambiguator)` where disambiguator is `v.targetUrl || normalizeTitle(v.title)` or `"untitled-{index}"` as fallback
4. Write the `contentHash` field onto each material object.
5. Save the registry via `saveRegistry()`.
6. Print a summary: how many materials were hashed, per period.

## Implementation

```javascript
#!/usr/bin/env node
/**
 * backfill-content-hashes.mjs — One-time migration to add contentHash
 * to all existing materials in the lesson registry.
 *
 * Idempotent: re-running overwrites hashes with the same values.
 *
 * Usage:
 *   node scripts/backfill-content-hashes.mjs
 *   node scripts/backfill-content-hashes.mjs --dry-run
 */

import { loadRegistry, saveRegistry } from './lib/lesson-registry.mjs';
import { computeContentHash, normalizeTitle } from './lib/content-hash.mjs';

const dryRun = process.argv.includes('--dry-run');

const registry = loadRegistry();
let totalHashed = 0;
const perPeriod = { B: 0, E: 0 };

for (const [key, entry] of Object.entries(registry)) {
  const { unit, lesson } = entry;
  if (!unit || !lesson) continue;

  for (const period of ['B', 'E']) {
    const sch = entry.schoology?.[period];
    if (!sch?.materials) continue;

    for (const [type, mat] of Object.entries(sch.materials)) {
      if (type === 'videos') {
        if (!Array.isArray(mat)) continue;
        for (let i = 0; i < mat.length; i++) {
          const v = mat[i];
          if (!v || typeof v !== 'object') continue;
          const disambig = v.targetUrl || normalizeTitle(v.title) || `untitled-${i}`;
          v.contentHash = computeContentHash(unit, lesson, 'video', disambig);
          totalHashed++;
          perPeriod[period]++;
        }
      } else if (mat && typeof mat === 'object') {
        mat.contentHash = computeContentHash(unit, lesson, type);
        totalHashed++;
        perPeriod[period]++;
      }
    }
  }
}

if (!dryRun) {
  saveRegistry(registry);
  console.log(`[backfill] Saved registry with content hashes`);
} else {
  console.log(`[dry-run] Would save registry (no changes written)`);
}

console.log(`[backfill] Hashed ${totalHashed} materials (B: ${perPeriod.B}, E: ${perPeriod.E})`);
```

## Key Points
- **Idempotent**: running twice produces the same result
- **Non-destructive**: only adds `contentHash` field, never removes existing fields
- **`--dry-run`** flag: shows what would happen without writing
- Videos with neither `targetUrl` nor `title` use `"untitled-{index}"` as fallback

## Verification
```bash
node --check scripts/backfill-content-hashes.mjs
node scripts/backfill-content-hashes.mjs --dry-run
```
Both must work without errors.
