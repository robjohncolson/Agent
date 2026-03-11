# Step 1.4: Wire Validation into lesson-registry.mjs Write Functions

## Task
Add schema validation calls to the three write functions in `scripts/lib/lesson-registry.mjs` so invalid data is rejected before being written to the registry.

## File to Modify
`scripts/lib/lesson-registry.mjs`

## Dependencies
- `scripts/lib/registry-validator.mjs` must exist (created in Step 1.1)

## Changes

### 1. Add import at top of file
Add after the existing imports:
```javascript
import { validateMaterial, validateSchoologyState } from './registry-validator.mjs';
```

### 2. Add validation to `updateSchoologyMaterial()` (currently starts at line ~383)
Add validation BEFORE the array check (before line ~401). Insert right after the registry initialization code and before the `// Arrays (e.g. videos)` comment:

```javascript
  // --- Validate before write ---
  const validation = validateMaterial(type, materialData);
  if (!validation.valid) {
    const msg = `[registry] Validation failed for ${unitNum}.${lessonNum} ${period}.${type}:\n` +
      validation.errors.map(e => `  - ${e}`).join('\n');
    throw new Error(msg);
  }
```

### 3. Add validation to `setSchoologyState()` (currently starts at line ~355)
Add validation AFTER the state object parameter is received but BEFORE the write. Insert before the `registry[key].schoology[period] = {` line:

```javascript
  // --- Validate before write ---
  const validation = validateSchoologyState(state, period);
  if (!validation.valid) {
    const msg = `[registry] Validation failed for ${unitNum}.${lessonNum} schoology.${period}:\n` +
      validation.errors.map(e => `  - ${e}`).join('\n');
    throw new Error(msg);
  }
```

### 4. Do NOT add validation to `upsertLesson()`
The `upsertLesson()` function handles generic partial merges and doesn't directly write schoology materials. Validation there would be premature — the specific material write functions (`updateSchoologyMaterial`, `setSchoologyState`) are the enforcement points.

## Error Handling Philosophy
- **Writes throw.** A validation failure is a programming error — silent corruption is worse than a crash.
- **Callers catch.** Scripts that batch-process should catch validation errors per-material, log them, and continue.

## Existing Code Context
The `updateSchoologyMaterial` function currently:
1. Loads registry
2. Ensures entry + schoology + period structure exists
3. Writes materialData (array-aware)
4. Saves registry

Validation goes between steps 2 and 3.

The `setSchoologyState` function currently:
1. Loads registry
2. Ensures entry + schoology structure exists
3. Writes the full state object
4. Saves registry

Validation goes between steps 2 and 3.

## Verification
```bash
node --check scripts/lib/lesson-registry.mjs
```
Must exit 0. Invalid writes should throw; valid writes should succeed unchanged.
