# Registry Hardening — Dependency Graph

## Parallelization Map

```
Wave 1 (fully parallel — no dependencies):
  ├── Step 1.1: Create registry-validator.mjs
  ├── Step 2.1: Create content-hash.mjs
  └── Step 3.4: Add stale_material issue to reconciler

Wave 2 (depends on Wave 1):
  ├── Step 1.2: Add --validate to schoology-reconcile.mjs   ← depends on 1.1
  ├── Step 2.2: Create backfill-content-hashes.mjs          ← depends on 2.1
  └── Step 1.3: Run --validate, fix violations              ← depends on 1.2 (MANUAL)

Wave 3 (depends on Wave 2):
  ├── Step 1.4: Wire validation into lesson-registry.mjs    ← depends on 1.1, 1.3
  └── Step 2.3: Run backfill                                ← depends on 2.2 (MANUAL)

Wave 4 (depends on Wave 3):
  ├── Step 2.4: Wire auto-hash into updateSchoologyMaterial ← depends on 1.4, 2.1
  └── Step 2.5+3.1: Update sync-tree (hash + liveness)      ← depends on 2.1
       (combined — both touch the same file)

Wave 5 (depends on Wave 4):
  ├── Step 2.6+3.3: Update catch-up-diff (hash + staleness) ← depends on 2.3
  └── Step 2.7+3.2: Update batch-copy (hash + staleness)    ← depends on 2.3
```

## Step Details for Codex Dispatch

### Wave 1 — 3 parallel agents

| Agent | Step | New File | Test |
|-------|------|----------|------|
| A | 1.1 | `scripts/lib/registry-validator.mjs` | `node --check` + inline tests |
| B | 2.1 | `scripts/lib/content-hash.mjs` | `computeContentHash(6,7,'worksheet')` returns 12 hex |
| C | 3.4 | Modify `scripts/lib/schoology-reconcile.mjs` + CLI | `stale_material` in ISSUE_TYPES |

### Wave 2 — 2 parallel agents + 1 manual

| Agent | Step | Files | Test |
|-------|------|-------|------|
| D | 1.2 | `scripts/schoology-reconcile.mjs` | `--validate` flag runs without crash |
| E | 2.2 | `scripts/backfill-content-hashes.mjs` (new) | `node --check` passes |
| MANUAL | 1.3 | Run `--validate`, fix violations in registry | `--validate` exits 0 |

### Wave 3 — 1 agent + 1 manual

| Agent | Step | Files | Test |
|-------|------|-------|------|
| F | 1.4 | `scripts/lib/lesson-registry.mjs` | Invalid write throws, valid write succeeds |
| MANUAL | 2.3 | Run backfill script | Spot-check 3 materials for contentHash |

### Wave 4 — 2 parallel agents

| Agent | Step | Files | Test |
|-------|------|-------|------|
| G | 2.4 | `scripts/lib/lesson-registry.mjs` | `updateSchoologyMaterial()` auto-sets contentHash |
| H | 2.5+3.1 | `scripts/sync-tree-to-registry.mjs` | Synced materials have contentHash + lastSeenAt |

### Wave 5 — 2 parallel agents

| Agent | Step | Files | Test |
|-------|------|-------|------|
| I | 2.6+3.3 | `scripts/lib/catch-up-diff.mjs` | Hash-based compliance + staleness check |
| J | 2.7+3.2 | `scripts/batch-copy-to-period-e.mjs` | Hash skip + stale skip with log messages |

## Total: 10 Codex agents across 5 waves, 2 manual steps
