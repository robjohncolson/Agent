# Step 2: Data Migration Script

## Task
Create a new script `scripts/migrate-registry-multi-period.mjs` that converts existing flat `schoology` objects in the lesson registry to the new per-period `{ B: {...} }` format.

## Files to Create
- `scripts/migrate-registry-multi-period.mjs` (NEW FILE)

## Requirements

### CLI Interface
```bash
node scripts/migrate-registry-multi-period.mjs              # Preview (dry run)
node scripts/migrate-registry-multi-period.mjs --execute     # Apply migration
```

### Algorithm
1. Load `state/lesson-registry.json` via `loadRegistry()` from `scripts/lib/lesson-registry.mjs`
2. For each entry in the registry:
   - If `entry.schoology` has a `folderId` property (old flat format):
     - Wrap the entire `schoology` object: `entry.schoology = { B: <old schoology object> }`
   - If `entry.schoology` already has single-letter keys whose values are objects with `folderId` → skip (already migrated)
   - If `entry.schoology` is empty `{}` or null → skip
3. In preview mode: print what would change, do NOT write
4. In `--execute` mode:
   - Back up the current registry to `state/lesson-registry.pre-multiperiod.json`
   - Save the migrated registry via `saveRegistry()`

### Detection Heuristic
```javascript
function isOldFormat(schoology) {
  if (!schoology || typeof schoology !== 'object') return false;
  // Old format has folderId at the top level
  return 'folderId' in schoology;
}

function isNewFormat(schoology) {
  if (!schoology || typeof schoology !== 'object') return false;
  // New format has single-letter keys (B, E) whose values are objects
  return Object.keys(schoology).some(k =>
    k.length === 1 && typeof schoology[k] === 'object' && schoology[k] !== null
  );
}
```

### Output Format
```
Multi-Period Registry Migration
================================

Preview mode (use --execute to apply)

[MIGRATE] 5.1: wrapping flat schoology → { B: {...} }  (folderId: 985937488)
[MIGRATE] 5.2: wrapping flat schoology → { B: {...} }  (folderId: 985937489)
[SKIP]    5.3: schoology already in new format
[SKIP]    5.4: schoology is empty

Summary: 40 migrated, 3 skipped, 0 errors
```

### Imports Needed
```javascript
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT } from './lib/paths.mjs';
import { loadRegistry, saveRegistry } from './lib/lesson-registry.mjs';
```

### Backup
- Copy `state/lesson-registry.json` to `state/lesson-registry.pre-multiperiod.json` before writing
- Use `copyFileSync` for the backup (preserves exact contents)

## Constraints
- The script must be idempotent — running it twice on already-migrated data does nothing
- Use `#!/usr/bin/env node` shebang
- Do NOT import or depend on any other scripts (only lesson-registry.mjs and paths.mjs)
- Print clear summary at the end
