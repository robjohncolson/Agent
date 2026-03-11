# Step 3.4: Add stale_material Issue Type to Reconciler

## Task
Add a `stale_material` issue type to the reconciler so it reports materials that have been marked stale (not seen in the last Schoology scrape).

## Files to Modify
1. `scripts/lib/schoology-reconcile.mjs` — add issue type + detection logic
2. `scripts/schoology-reconcile.mjs` — add stale_material to the "do not auto-fix" list

## Changes to `scripts/lib/schoology-reconcile.mjs`

### 1. Add to ISSUE_TYPES (line ~13)
Add this entry to the ISSUE_TYPES object:
```javascript
stale_material: 'warning',
```

### 2. Add stale detection to `reconcileLesson()` function
After the existing checks (URL target mismatch is check #9), add a new check #10 for stale materials. This should come after line ~327, before `const status = issues.length === 0 ? 'reconciled' : 'issues';`.

```javascript
  // 10. Stale material check — materials marked stale by sync-tree
  const schoologyPeriodData = registryEntry?.schoology?.[period];
  if (schoologyPeriodData?.materials) {
    for (const [type, mat] of Object.entries(schoologyPeriodData.materials)) {
      if (type === 'videos' && Array.isArray(mat)) {
        for (const v of mat) {
          if (v?.stale === true) {
            issues.push({
              lesson: key,
              severity: ISSUE_TYPES.stale_material,
              type: 'stale_material',
              detail: `Video "${v.title}" (${v.schoologyId}) marked stale — not seen in last scrape`,
              materialType: 'video',
              schoologyId: v.schoologyId,
            });
          }
        }
      } else if (mat?.stale === true) {
        issues.push({
          lesson: key,
          severity: ISSUE_TYPES.stale_material,
          type: 'stale_material',
          detail: `${type} (${mat.schoologyId}) marked stale — not seen in last scrape`,
          materialType: type,
          schoologyId: mat.schoologyId,
        });
      }
    }
  }
```

NOTE: The variable `schoologyPeriod` is already used earlier in the function (line ~153). Use a different name like `schoologyPeriodData` to avoid conflict, OR reuse the existing `schoologyPeriod` variable since it references the same data.

Actually, looking at the code more carefully, the existing `schoologyPeriod` variable at line 153 already has the right data. So you can reuse it:

```javascript
  // 10. Stale material check
  if (schoologyPeriod?.materials) {
    for (const [type, mat] of Object.entries(schoologyPeriod.materials)) {
      if (type === 'videos' && Array.isArray(mat)) {
        for (const v of mat) {
          if (v?.stale === true) {
            issues.push({
              lesson: key,
              severity: ISSUE_TYPES.stale_material,
              type: 'stale_material',
              detail: `Video "${v.title}" (${v.schoologyId}) marked stale — not seen in last scrape`,
              materialType: 'video',
              schoologyId: v.schoologyId,
            });
          }
        }
      } else if (mat?.stale === true) {
        issues.push({
          lesson: key,
          severity: ISSUE_TYPES.stale_material,
          type: 'stale_material',
          detail: `${type} (${mat.schoologyId}) marked stale — not seen in last scrape`,
          materialType: type,
          schoologyId: mat.schoologyId,
        });
      }
    }
  }
```

## Changes to `scripts/schoology-reconcile.mjs`

### Add `stale_material` to the do-not-auto-fix list
In the fix mode switch statement (around line ~251), add `stale_material` to the list of issue types that are not auto-fixed:

Find this block:
```javascript
      case 'missing_from_schoology':
      case 'orphaned_at_root':
      case 'missing_material':
      case 'extra_material':
      case 'duplicate_materials':
      case 'url_target_mismatch':
        break;
```

Add `case 'stale_material':` to it:
```javascript
      case 'missing_from_schoology':
      case 'orphaned_at_root':
      case 'missing_material':
      case 'extra_material':
      case 'duplicate_materials':
      case 'url_target_mismatch':
      case 'stale_material':
        break;
```

## Verification
```bash
node --check scripts/lib/schoology-reconcile.mjs
node --check scripts/schoology-reconcile.mjs
```
Both must exit 0.
