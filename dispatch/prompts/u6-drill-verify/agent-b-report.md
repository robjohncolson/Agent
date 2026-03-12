# Agent B — Drill Verification Report Formatter

## Task

Create `scripts/lib/drill-verify-report.mjs` — a module that formats and prints verification results as aligned console tables.

## Owned Files

- `scripts/lib/drill-verify-report.mjs` (create)

## Requirements

### Exports

```javascript
// Print Phase 1 registry audit results
export function printRegistryAudit(results);

// Print Phase 2 CDP verification results
export function printVerificationReport(results);

// Print Phase 4 final summary with actions taken
export function printSummary(results, options);
```

### `printRegistryAudit(results)`

Input: array of objects:
```javascript
[{
  lesson: 3,                    // lesson number
  urlCorrect: true,             // urls.drills matches truth table
  periods: {
    B: { status: 'ok' | 'missing' | 'wrong-url' | 'unverified' | 'no-folder' },
    E: { status: 'ok' | 'missing' | 'wrong-url' | 'unverified' | 'no-folder' },
  }
}]
```

Output format (console.log):
```
Phase 1: Registry Audit
Lesson  URL OK   Period B         Period E
──────  ──────   ────────         ────────
6.1     yes      missing          missing
6.2     yes      unverified       ok
...
```

### `printVerificationReport(results)`

Input: array of objects:
```javascript
[{
  lesson: 3,
  periods: {
    B: { status: 'match' | 'mismatch' | 'missing' | 'skipped', targetUrl?: string },
    E: { status: 'match' | 'mismatch' | 'missing' | 'skipped', targetUrl?: string },
  }
}]
```

Output format:
```
Phase 2: CDP Verification
Lesson  Period B     Period E
──────  ────────     ────────
6.1     match        missing
6.2     match        match
...
```

### `printSummary(results, options)`

Input: array of objects:
```javascript
[{
  lesson: 3,
  periodB: 'ok' | 'posted' | 'replaced' | 'deduped' | 'no-folder' | 'skipped',
  periodE: 'ok' | 'posted' | 'replaced' | 'deduped' | 'no-folder' | 'skipped',
  action: 'none' | string describing what was done
}]
```

Options:
```javascript
{ dryRun: boolean, fixCount: number }
```

Output format:
```
Phase 4: Summary
Lesson  Period B     Period E     Action
──────  ────────     ────────     ──────
6.1     posted       posted       fix: posted both
6.2     ok           ok           none
...
6.11    ok           deduped      fix: deleted duplicate

Total: 3 fixes applied.
```

If `dryRun` is true, append: `"Run with --fix to apply N changes"`

### Constraints

- No imports — pure formatting with `console.log`
- Use ES module syntax
- Column alignment: pad with spaces to keep columns aligned
- Use Unicode box-drawing character `─` for header separators
- Each function should handle an empty array gracefully (print header + "No results")

## Acceptance Criteria

- [ ] All 3 functions print formatted, aligned tables
- [ ] Empty arrays produce a header with "No results" message
- [ ] Dry-run hint appears when `options.dryRun === true`
- [ ] No external dependencies
