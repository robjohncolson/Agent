# Step 2.1: Create content-hash.mjs

## Task
Create `scripts/lib/content-hash.mjs` — a content-addressable identity module for registry materials.

## Context
Materials are currently identified by their Schoology ID, which changes on re-post. A content hash provides a stable identity based on the material's semantic content (unit, lesson, type), surviving re-posts and enabling deduplication.

## File to Create
`scripts/lib/content-hash.mjs`

## Exports

```javascript
export function normalizeTitle(title)                                    // → string
export function computeContentHash(unit, lesson, materialType, disambiguator = null)  // → 12-char hex string
export function findByContentHash(materials, hash)                       // → { type, material, index? } | null
```

## `normalizeTitle(title)`
Normalizes a material title for use as a video disambiguator:

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

## `computeContentHash(unit, lesson, materialType, disambiguator)`
Computes a deterministic SHA-256 hash (truncated to 12 hex chars) from:

For keyed materials (worksheet, drills, quiz, blooket):
```
input = "unit|lesson|materialType"
```

For videos (when disambiguator is provided):
```
input = "unit|lesson|video|disambiguator"
```

```javascript
import { createHash } from 'node:crypto';

function computeContentHash(unit, lesson, materialType, disambiguator = null) {
  const parts = [String(unit), String(lesson), materialType];
  if (disambiguator) parts.push(disambiguator);
  const input = parts.join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}
```

## `findByContentHash(materials, hash)`
Searches a materials object for a material with the given content hash:

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

## Verification
After creating the file, run:
```bash
node --check scripts/lib/content-hash.mjs
node -e "import('./scripts/lib/content-hash.mjs').then(m => { const h = m.computeContentHash(6, 7, 'worksheet'); console.log(h, h.length === 12 && /^[0-9a-f]+$/.test(h) ? 'PASS' : 'FAIL'); })"
```
Both must pass.
