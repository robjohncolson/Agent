# Step 1.1: Create registry-validator.mjs

## Task
Create `scripts/lib/registry-validator.mjs` — a schema validation module for the lesson registry.

## Context
The lesson registry (`state/lesson-registry.json`) has no structural validation. Any code path can write malformed data (wrong types, corrupted arrays, duplicate IDs). This module enforces correctness on every write.

## File to Create
`scripts/lib/registry-validator.mjs`

## Exports

```javascript
export function validateMaterial(type, data)           // → { valid, errors }
export function validateSchoologyState(state, period)  // → { valid, errors }
export function validateRegistryEntry(entry)            // → { valid, errors }
export function validateEntireRegistry(registry)        // → { valid, errors, errorCount }
```

## Validation Rules

### Material-level rules
| Field | Rule | Error message |
|---|---|---|
| `schoologyId` | Must be a string of digits (`/^\d+$/`) or `null` | `"schoologyId must be a digit string or null, got: {value}"` |
| `contentHash` | Must be a 12-char hex string (`/^[0-9a-f]{12}$/`) or absent | `"contentHash must be 12 hex chars, got: {value}"` |
| `title` | Must be a non-empty string or `null` | `"title must be a string or null"` |
| `href` | Must be a string starting with `https://` or `null` | `"href must be an https URL or null"` |
| `targetUrl` | Must be a string or `null` | `"targetUrl must be a string or null"` |
| `copiedFromId` | Must be a string of digits or absent | `"copiedFromId must be a digit string"` |

### Structural rules (per lesson+period)
| Rule | Scope |
|---|---|
| `videos` must be an array | `materials.videos` |
| `folderId` must be a digit string or null | `schoology[period].folderId` |
| No duplicate `schoologyId` within same lesson+period | all materials |
| No duplicate `contentHash` within same lesson+period | all materials |

### Keyed material completeness
For keyed materials (worksheet, drills, quiz, blooket), a valid entry is either:
- `null` (not yet created), OR
- An object with at least one of: `schoologyId`, `copiedFromId`, or `status: "failed"` / `status: "done"`

An empty object `{}` is invalid for a keyed material.

### `validateMaterial(type, data)` behavior:
- `null` / `undefined` → `{ valid: true, errors: [] }`
- `type === 'videos'` → must be Array; validate each element recursively
- Otherwise must be a plain object; check all field rules above

### `validateSchoologyState(state, period)` behavior:
- Validate `folderId`
- Validate all materials in `state.materials`
- Check for duplicate `schoologyId` across all materials
- Check for duplicate `contentHash` across all materials

### `validateRegistryEntry(entry)` behavior:
- Validate `entry.schoology.B` and `entry.schoology.E` if present (using `validateSchoologyState`)
- `entry.unit` must be a positive integer
- `entry.lesson` must be a positive integer

### `validateEntireRegistry(registry)` behavior:
- Iterate all entries, call `validateRegistryEntry` on each
- Return `{ valid, errors: [{lesson, ...}], errorCount }`

## Constants
```javascript
const DIGIT_STRING = /^\d+$/;
const HEX_12 = /^[0-9a-f]{12}$/;
const HTTPS_URL = /^https:\/\//;
const KEYED_TYPES = new Set(['worksheet', 'drills', 'quiz', 'blooket']);
```

## Implementation Reference
The spec includes a full reference implementation in Section 3.4. Follow that pattern closely.

## Verification
After creating the file, run:
```bash
node --check scripts/lib/registry-validator.mjs
```
This must exit 0 (no syntax errors).
