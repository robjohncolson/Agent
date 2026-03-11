# Step 6: Reconciliation CLI

## Task
Create `scripts/schoology-reconcile.mjs` — a CLI wrapper that loads the scraped tree and registry, runs reconciliation, and prints a human-readable report. Supports `--fix` mode to auto-correct registry drift.

## Depends On
- Step 5: `scripts/lib/schoology-reconcile.mjs` (reconcile library)
- Step 4: `scripts/lib/lesson-registry.mjs` (registry API with unified format)

## Create: `scripts/schoology-reconcile.mjs`

### CLI Interface
```bash
node scripts/schoology-reconcile.mjs                            # Full reconciliation
node scripts/schoology-reconcile.mjs --unit 6 --lesson 4        # Single lesson
node scripts/schoology-reconcile.mjs --fix                      # Auto-fix registry from tree
node scripts/schoology-reconcile.mjs --json                     # Raw JSON output
node scripts/schoology-reconcile.mjs --tree state/custom.json   # Custom tree path
```

### Imports
```javascript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadRegistry, setSchoologyState, updateUrl } from './lib/lesson-registry.mjs';
import { reconcile, reconcileLesson, validateFolderUrl } from './lib/schoology-reconcile.mjs';
```

### Main Flow

1. **Load data**:
   - Read `state/schoology-tree.json` (or custom path from `--tree`)
   - Load registry via `loadRegistry()`
   - If tree file doesn't exist, print error: "Run `node scripts/schoology-deep-scrape.mjs` first"

2. **Run reconciliation**:
   - If `--unit` and `--lesson` specified: call `reconcileLesson()` for just that lesson
   - Otherwise: call `reconcile()` for all lessons

3. **Print report**:
   - Summary line: "42 lessons checked, 35 reconciled, 5 with issues, 2 orphans"
   - For each issue, print with severity icon:
     - `[ERROR]` red — wrong folder, orphaned, missing from schoology, URL mismatch
     - `[WARN]`  yellow — malformed URL, missing material, duplicates
     - `[INFO]`  dim — extra materials
   - Format: `[ERROR] 6.4: wrong_folder — Registry says folder 987073401 but found in 986218661 (Q3/week 23/Friday 3/6/26)`

4. **`--fix` mode**:
   For each issue, apply automatic fixes where safe:
   - `malformed_folder_url` → Clean URL via `updateUrl()` (auto-fix takes last `f=`)
   - `wrong_folder` → Update `urls.schoologyFolder` to actual folder from tree
   - `status_drift` → Update `status.schoology` to match reality
   - `wrong_folder` + tree has folder path → Update `schoology.folderPath` from tree
   - Do NOT auto-fix: `missing_from_schoology`, `orphaned_at_root` (these need human/CDP action)
   - Print each fix applied: `[FIX] 6.4: Updated schoologyFolder to ?f=986218661`
   - After all fixes: save registry

5. **`--json` mode**:
   - Print the full `ReconciliationReport` as JSON to stdout
   - Skip human-readable formatting
   - Useful for piping to dashboard or other tools

### Report Format (human-readable)
```
========================================
  Schoology-Registry Reconciliation
  Tree: state/schoology-tree.json (scraped 2026-03-10T15:30:00Z)
========================================

Summary: 42 lessons, 35 OK, 5 issues, 2 orphans

[ERROR] 6.4: wrong_folder
        Registry: f=987073401  Actual: f=986218661
        Path: Q3 / week 23 / Friday 3/6/26

[WARN]  6.4: malformed_folder_url
        URL: ?f=987073311?f=987073401

[ERROR] 6.5: orphaned_at_root
        3 materials at course root: worksheet, drills, blooket

[WARN]  6.12: missing_material
        Missing: quiz (expected Quiz 6.11)

========================================
  5 issues found (2 errors, 2 warnings, 1 info)
========================================
```

### Exit Code
- 0 if all lessons reconciled (or `--fix` applied successfully)
- 1 if any errors found (warnings don't cause failure)

## Constraints
- Pure CLI — no CDP connection needed
- Read-only by default; `--fix` is the only mode that writes
- Handle missing tree file gracefully
- Handle empty registry gracefully

## Verification
```bash
node -c scripts/schoology-reconcile.mjs
# Requires state/schoology-tree.json from step 2
```
