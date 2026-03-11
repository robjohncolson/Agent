# Step 7: Pipeline Integration

## Task
Update `scripts/post-to-schoology.mjs` to store unified Schoology state after posting, and update `scripts/lesson-prep.mjs` to run reconciliation as a post-pipeline validation step.

## Depends On
- Step 4: Registry API (`setSchoologyState`, `updateSchoologyMaterial`)
- Step 6: Reconciliation CLI (`scripts/schoology-reconcile.mjs`)

## Modify: `scripts/post-to-schoology.mjs`

### 1. Import new registry functions
Add to existing imports:
```javascript
import { updateSchoologyMaterial, setSchoologyState } from './lib/lesson-registry.mjs';
```

### 2. After creating/navigating to folder, store folder state
When a folder is created or navigated to, immediately store it in the unified format:
```javascript
// After folder creation/navigation succeeds:
setSchoologyState(unit, lesson, {
  folderId: extractedFolderId,
  folderPath: folderPathSegments,  // e.g., ["Q3", "week 24", "Wednesday 3/11/26"]
  folderTitle: folderTitle,
  verifiedAt: null,
  reconciledAt: null,
  materials: {},  // Will be populated per-link below
});
```

The `folderPathSegments` should be built from the `--folder-path` arg split by `/` plus the `--create-folder` title. For example:
- `--folder-path "Q3/week 24" --create-folder "Wednesday 3/11/26"`
- → `folderPathSegments = ["Q3", "week 24", "Wednesday 3/11/26"]`

### 3. After each link is posted, store material state
Replace calls to `updateSchoologyLink()` with `updateSchoologyMaterial()`:

**Before** (current):
```javascript
updateSchoologyLink(unit, lesson, link.key, {
  status: "done",
  postedAt: new Date().toISOString(),
  title: link.title,
  verified: verifiedOk,
});
```

**After** (new):
```javascript
updateSchoologyMaterial(unit, lesson, link.key, {
  schoologyId: null,  // Not known at post time; reconciliation will fill this
  title: link.title,
  href: null,         // Not known until scraped
  targetUrl: link.url,
  postedAt: new Date().toISOString(),
  verified: verifiedOk,
  status: "done",
});
```

On failure:
```javascript
updateSchoologyMaterial(unit, lesson, link.key, {
  targetUrl: link.url,
  status: "failed",
  error: errorMessage,
  attemptedAt: new Date().toISOString(),
});
```

### 4. Store clean folder URL
When setting `urls.schoologyFolder`, ensure it's well-formed:
```javascript
// Instead of:
updateUrl(unit, lesson, 'schoologyFolder', materialsUrl);
// The URL validation in step 4's updateUrl() will auto-fix double ?f= params
// Just call it normally — the validation handles the rest
```

## Modify: `scripts/lesson-prep.mjs`

### Add reconciliation as post-pipeline step (task runner mode)

In the task runner code path (after `runPipeline()` returns), add a reconciliation check:

```javascript
// After pipeline results are printed:
if (success) {
  console.log('\n  Running post-pipeline reconciliation...');
  try {
    const treePath = path.join(AGENT_ROOT, 'state', 'schoology-tree.json');
    if (fs.existsSync(treePath)) {
      const { reconcileLesson } = await import('./lib/schoology-reconcile.mjs');
      const tree = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
      const entry = getLesson(unit, lesson);
      const report = reconcileLesson(unit, lesson, entry, tree);
      if (report.issues.length === 0) {
        console.log(`  [ok] Lesson ${unit}.${lesson} reconciled — no issues`);
      } else {
        console.log(`  [!!] ${report.issues.length} reconciliation issue(s):`);
        for (const issue of report.issues) {
          console.log(`       [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.detail}`);
        }
      }
    } else {
      console.log('  [--] No schoology-tree.json — skipping reconciliation (run schoology-deep-scrape.mjs first)');
    }
  } catch (err) {
    console.warn(`  [!!] Reconciliation failed: ${err.message}`);
  }
}
```

### Add reconciliation to pipeline definition (optional)
Add a new step to `pipelines/lesson-prep.json`:
```json
{
  "task": "reconcile-schoology",
  "depends_on": ["verify-schoology"],
  "defined": false
}
```
Mark as `defined: false` for now — it's just a placeholder. The inline reconciliation above handles it until a proper task definition is created.

## Constraints
- Do NOT remove existing `updateSchoologyLink()` calls yet — they're deprecated (step 4) but callers in heal mode may still use them
- Only update the non-heal posting path to use new functions
- Reconciliation is informational (print warnings), not blocking (don't abort pipeline on issues)
- The reconciliation step is best-effort — if tree file doesn't exist, skip gracefully

## Verification
```bash
node -c scripts/post-to-schoology.mjs
node -c scripts/lesson-prep.mjs
```
