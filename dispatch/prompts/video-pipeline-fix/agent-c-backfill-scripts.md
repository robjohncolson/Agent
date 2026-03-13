# Agent C: Batch Schoology backfill scripts

## Task

Create two batch scripts for Schoology backfill operations. These scripts read the lesson registry and invoke `post-to-schoology.mjs` for each lesson that needs updating.

## File Ownership

You may ONLY create:
- `scripts/backfill-schoology-videos.mjs`
- `scripts/backfill-period-e.mjs`

Do NOT modify any existing files.

## Script 1: `scripts/backfill-schoology-videos.mjs`

Posts AP Classroom video links to existing Schoology folders for Period B.

### Logic:
1. Read `state/lesson-registry.json`
2. For each lesson:
   - Skip if no `urls.schoologyFolder` (no Period B folder)
   - Skip if `schoology.B.materials.video1` already exists (videos already posted)
   - Otherwise, add to the backfill list
3. If `--dry-run`, print the list and exit
4. Otherwise, execute sequentially (CDP browser constraint):
   ```
   node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --only video --no-prompt
   ```
5. Wait 3 seconds between each lesson (rate limiting)
6. Print summary at end

### CLI:
```
node scripts/backfill-schoology-videos.mjs [--dry-run] [--unit N]
```
- `--dry-run`: list only, no execution
- `--unit N`: filter to a specific unit

## Script 2: `scripts/backfill-period-e.mjs`

Posts all materials to Period E Schoology folders for lessons missing Period E.

### Logic:
1. Read `state/lesson-registry.json`
2. For each lesson:
   - Skip if `urls.schoologyFolderE` already exists (Period E already done)
   - Skip if no `urls.schoologyFolder` (Period B not done yet — do B first)
   - Otherwise, add to the backfill list
3. If `--dry-run`, print the list and exit
4. Otherwise, execute sequentially:
   ```
   node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798 --no-prompt
   ```
5. Wait 5 seconds between each lesson (folder creation is slower)
6. Print summary at end

### CLI:
```
node scripts/backfill-period-e.mjs [--dry-run] [--unit N]
```

## Shared patterns

Both scripts should:
- Use `import { readFileSync } from "node:fs"` and `import { execSync } from "node:child_process"`
- Use `import { join } from "node:path"` with `AGENT_ROOT` from `./lib/paths.mjs`
- Parse lesson key as `const [unit, lesson] = key.split(".")`
- Have a shebang: `#!/usr/bin/env node`
- Print progress: `[3/46] Posting videos for 6.3...`
- Catch and report errors per-lesson without stopping the entire batch
- Sort lessons numerically (1.1, 1.2, ..., 9.6)

## Registry schema reference

```json
{
  "6.3": {
    "urls": {
      "schoologyFolder": "https://lynnschools.schoology.com/course/7945275782/materials?f=...",
      "schoologyFolderE": "https://lynnschools.schoology.com/course/7945275798/materials?f=..."
    },
    "schoology": {
      "B": {
        "materials": {
          "worksheet": {...},
          "video1": {...},
          "video2": {...}
        }
      },
      "E": {
        "materials": {...}
      }
    }
  }
}
```

## Acceptance

- Both scripts run with `--dry-run` and print correct lists
- Without `--dry-run`, they invoke `post-to-schoology.mjs` correctly
- Errors on individual lessons don't crash the batch
- Numerical sort order (not lexicographic)
