# Step 1.2: Add --validate Flag to schoology-reconcile.mjs

## Task
Add a `--validate` CLI flag to `scripts/schoology-reconcile.mjs` that loads the entire registry and runs schema validation on every entry, printing all errors.

## File to Modify
`scripts/schoology-reconcile.mjs`

## Dependencies
- `scripts/lib/registry-validator.mjs` must exist (created in Step 1.1)

## Changes

### 1. Add --validate to parseArgs options (around line ~41)
Add to the options object:
```javascript
validate: { type: 'boolean', default: false },
```

### 2. Add --validate to help text (around line ~53)
Add this line to the help output:
```
  --validate     Run schema validation on the entire registry (no tree needed)
```

### 3. Add validate handler BEFORE the tree loading logic (before line ~83)
Insert a new block after the help handler and before the tree loading code:

```javascript
// ── Validate mode (no tree needed) ─────────────────────────────────────────

if (args.validate) {
  const { validateEntireRegistry } = await import('./lib/registry-validator.mjs');
  const registry = loadRegistry();
  const result = validateEntireRegistry(registry);

  console.log('');
  console.log('=== Registry Validation ===');
  console.log('');

  if (result.errors.length === 0) {
    const entryCount = Object.keys(registry).length;
    console.log(`[OK] All ${entryCount} lessons passed schema validation`);
  } else {
    // Group errors by lesson
    const byLesson = {};
    for (const err of result.errors) {
      const key = err.lesson || 'unknown';
      if (!byLesson[key]) byLesson[key] = [];
      byLesson[key].push(err);
    }

    for (const [lesson, errors] of Object.entries(byLesson).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true })
    )) {
      for (const err of errors) {
        console.log(`[FAIL] ${lesson}: ${err.message || err.error || JSON.stringify(err)}`);
      }
    }

    // Print OK lessons too
    for (const key of Object.keys(registry).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    )) {
      if (!byLesson[key]) {
        const entry = registry[key];
        const matCount = countMaterials(entry);
        console.log(`[OK]   ${key}: ${matCount} materials valid`);
      }
    }
  }

  console.log('');
  console.log(`Summary: ${result.errorCount} error${result.errorCount !== 1 ? 's' : ''} in ${Object.keys(result.errors.reduce((m, e) => { m[e.lesson || '?'] = 1; return m; }, {})).length} lessons, ${Object.keys(registry).length - Object.keys(result.errors.reduce((m, e) => { m[e.lesson || '?'] = 1; return m; }, {})).length} lessons valid`);
  console.log('');
  process.exit(result.errorCount > 0 ? 1 : 0);
}

function countMaterials(entry) {
  let count = 0;
  for (const period of ['B', 'E']) {
    const mats = entry?.schoology?.[period]?.materials;
    if (!mats) continue;
    for (const [type, mat] of Object.entries(mats)) {
      if (type === 'videos' && Array.isArray(mat)) {
        count += mat.length;
      } else if (mat && typeof mat === 'object') {
        count++;
      }
    }
  }
  return count;
}
```

## Important
- The `--validate` mode must NOT require a scraped tree file. It only needs the registry.
- Place the validate handler BEFORE the tree file existence check so it short-circuits.
- Exit code 1 if any validation errors found, 0 if clean.

## Verification
```bash
node scripts/schoology-reconcile.mjs --validate
```
Should print a validation report and exit without crashing.
