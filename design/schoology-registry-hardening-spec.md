# Schoology-Registry Hardening Spec

**Goal**: Make the lesson registry a 1:1 reflection of Schoology reality, with a deep search function, reconciliation engine, and unified data model.

**Status**: SPEC COMPLETE — ready for implementation

---

## Problem Statement

The pipeline posts lesson materials to Schoology and records results in a local JSON registry (`state/lesson-registry.json`). Multiple systemic issues cause the registry to drift from Schoology reality:

1. **Three redundant Schoology representations** in the registry:
   - `urls.schoologyFolder` — folder URL set by the posting pipeline
   - `schoology.*` — materials/folders snapshot set by the scraper
   - `schoologyLinks.*` — per-link posting log set by heal mode
   These can contradict each other and none is authoritative.

2. **Folder URL corruption** — `schoologyFolder` gets malformed (e.g., `?f=987073311?f=987073401` — double `?f=` from stacked navigation).

3. **No deep search** — if a link exists 3+ levels deep in Schoology's folder tree, nothing discovers it. Scrapes are shallow or folder-specific.

4. **Wrong folder placement** — the pipeline sometimes posts links to the course root instead of the correct nested folder (e.g., `Q3/week 24/Wednesday 3/11/26`). The registry marks `schoology: "done"` regardless.

5. **No reconciliation loop** — no process compares what's in the registry with what's actually in Schoology and flags mismatches.

6. **Flat JSON file** — no querying, no history, no multi-machine consistency.

---

## Architecture

### Phase 1: Deep Schoology Scraper (`scripts/schoology-deep-scrape.mjs`)

A recursive CDP crawl of the entire course folder tree that builds a complete, normalized map of every folder and material in the course.

**Output**: `state/schoology-tree.json`

```json
{
  "courseId": "7945275782",
  "scrapedAt": "ISO8601",
  "stats": { "totalFolders": 87, "totalMaterials": 233, "maxDepth": 4 },
  "folders": {
    "986721319": {
      "id": "986721319",
      "title": "Topic 6.10",
      "path": ["Q3", "week 24", "Monday 3/16/26"],
      "parentId": "986588515",
      "depth": 3,
      "children": ["986721320"],
      "materials": ["8285243425", "8285243838"]
    }
  },
  "materials": {
    "8285243425": {
      "id": "8285243425",
      "title": "Topic 6.10 — Follow-Along Worksheet",
      "type": "link",
      "href": "https://lynnschools.schoology.com/course/.../link/view/8285243425",
      "targetUrl": "https://robjohncolson.github.io/apstats-live-worksheet/u6_lesson10_live.html",
      "folderId": "986721319",
      "folderPath": ["Q3", "week 24", "Monday 3/16/26", "Topic 6.10"],
      "parsedLesson": { "unit": 6, "lesson": 10 },
      "parsedType": "worksheet"
    }
  },
  "lessonIndex": {
    "6.10": {
      "folders": ["986721319"],
      "materials": ["8285243425", "8285243838", "8285244776"],
      "primaryFolder": "986721319",
      "folderPath": ["Q3", "week 24", "Monday 3/16/26", "Topic 6.10"]
    }
  }
}
```

**Key improvements over existing `scrape-schoology.mjs`:**
- **Unlimited recursion** with depth tracking
- **Flat lookup maps** (`folders`, `materials`) instead of nested tree — enables O(1) lookups
- **lessonIndex** — pre-computed reverse index: given a lesson, find all its folders and materials instantly
- **targetUrl extraction** — unwrap Schoology redirect wrappers to get the actual destination URL
- **parsedLesson/parsedType** — every material is classified at scrape time using existing `parseTopicFromTitle()` + `classifyMaterial()` logic

**Reuses**: `cdp-connect.mjs`, `schoology-dom.mjs` (`listItems`, `navigateToFolder`), `sync-schoology-to-registry.mjs` (`parseTopicFromTitle`, `classifyMaterial`)

**CLI**:
```bash
node scripts/schoology-deep-scrape.mjs                    # Full scrape, Period B
node scripts/schoology-deep-scrape.mjs --course E         # Period E
node scripts/schoology-deep-scrape.mjs --folder 986721319 # Scrape subtree only
node scripts/schoology-deep-scrape.mjs --output state/schoology-tree-E.json
```

### Phase 2: Reconciliation Engine (`scripts/lib/schoology-reconcile.mjs`)

A pure function library (no CDP, no side effects) that compares registry state against the scraped tree and produces a structured diff report.

**Input**: `state/lesson-registry.json` + `state/schoology-tree.json`
**Output**: `state/reconciliation-report.json`

```json
{
  "generatedAt": "ISO8601",
  "summary": {
    "totalLessons": 42,
    "fullyReconciled": 35,
    "mismatches": 5,
    "orphanedInSchoolgy": 2,
    "missingFromSchoology": 0
  },
  "issues": [
    {
      "lesson": "6.4",
      "severity": "error",
      "type": "wrong_folder",
      "detail": "Registry says folder 987073401 but materials found in folder 986218661 (path: Q3/week 23/Friday 3/6/26)",
      "registryFolder": "987073401",
      "actualFolder": "986218661",
      "actualPath": ["Q3", "week 23", "Friday 3/6/26"]
    },
    {
      "lesson": "6.4",
      "severity": "warning",
      "type": "malformed_folder_url",
      "detail": "schoologyFolder URL contains double ?f= params",
      "url": "?f=987073311?f=987073401"
    },
    {
      "lesson": "6.5",
      "severity": "error",
      "type": "orphaned_at_root",
      "detail": "3 materials found at course root level, expected in folder",
      "orphanedMaterials": ["8285243425", "8285243838", "8285244776"]
    },
    {
      "lesson": "6.12",
      "severity": "warning",
      "type": "missing_from_schoology",
      "detail": "Registry has status=done but no materials found in Schoology",
      "registryStatus": "done"
    },
    {
      "lesson": "5.3",
      "severity": "info",
      "type": "duplicate_materials",
      "detail": "Worksheet link exists in 2 folders",
      "duplicateLocations": ["985937488", "985937500"]
    }
  ],
  "perLesson": {
    "6.10": {
      "status": "reconciled",
      "registryFolder": "986721319",
      "schoologyFolder": "986721319",
      "folderPath": ["Q3", "week 24", "Monday 3/16/26", "Topic 6.10"],
      "expectedMaterials": ["worksheet", "drills", "quiz", "blooket"],
      "foundMaterials": ["worksheet", "drills", "quiz", "blooket"],
      "missing": [],
      "extra": []
    }
  }
}
```

**Issue types detected:**
| Type | Severity | Meaning |
|------|----------|---------|
| `wrong_folder` | error | Materials in different folder than registry records |
| `orphaned_at_root` | error | Materials at course root, should be in a folder |
| `malformed_folder_url` | warning | Corrupted `schoologyFolder` URL |
| `missing_from_schoology` | error | Registry says done but nothing in Schoology |
| `missing_material` | warning | Some expected materials missing from folder |
| `extra_material` | info | Unexpected materials in lesson folder |
| `duplicate_materials` | warning | Same material in multiple folders |
| `folder_path_mismatch` | warning | Folder exists but not in expected hierarchy position |
| `url_target_mismatch` | error | Schoology link points to wrong URL (not matching registry) |
| `status_drift` | warning | Registry status contradicts Schoology state |

**Exported functions:**
```javascript
export function reconcile(registry, schoologyTree) → ReconciliationReport
export function reconcileLesson(unit, lesson, registryEntry, schoologyTree) → LessonReport
export function findLessonInTree(unit, lesson, schoologyTree) → { folders, materials, primaryFolder }
export function detectOrphans(schoologyTree) → OrphanedMaterial[]
export function validateFolderUrl(url) → { valid: boolean, folderId?: string, error?: string }
```

**CLI** (`scripts/schoology-reconcile.mjs`):
```bash
node scripts/schoology-reconcile.mjs                            # Full reconciliation
node scripts/schoology-reconcile.mjs --unit 6 --lesson 4        # Single lesson
node scripts/schoology-reconcile.mjs --fix                      # Auto-fix registry from tree
node scripts/schoology-reconcile.mjs --json                     # Output raw JSON (for dashboard)
```

### Phase 3: Registry Hardening (`scripts/lib/lesson-registry.mjs` modifications)

Unify the three Schoology representations into a single, authoritative structure.

**Before** (current — 3 competing objects):
```json
{
  "urls": { "schoologyFolder": "..." },
  "schoology": { "materials": [...], "folderIds": [...], "dayFolders": [...] },
  "schoologyLinks": { "worksheet": { "status": "done", "verified": true } }
}
```

**After** (unified):
```json
{
  "urls": { "schoologyFolder": "..." },
  "schoology": {
    "folderId": "986721319",
    "folderPath": ["Q3", "week 24", "Monday 3/16/26"],
    "folderTitle": "Topic 6.10",
    "verifiedAt": "ISO8601",
    "reconciledAt": "ISO8601",
    "materials": {
      "worksheet": {
        "schoologyId": "8285243425",
        "title": "Topic 6.10 — Follow-Along Worksheet",
        "href": "https://lynnschools.schoology.com/.../link/view/8285243425",
        "targetUrl": "https://robjohncolson.github.io/...",
        "postedAt": "ISO8601",
        "verified": true
      },
      "drills": { ... },
      "quiz": { ... },
      "blooket": { ... },
      "videos": [
        { "schoologyId": "...", "title": "...", "href": "...", "targetUrl": "..." }
      ]
    }
  }
}
```

**Changes to `lesson-registry.mjs`:**

1. **New URL_KEYS**: Add `schoologyFolderE` to `URL_KEYS` set
2. **New function `setSchoologyState(unit, lesson, state)`** — replaces both `schoology` and `schoologyLinks` with unified object
3. **New function `getSchoologyState(unit, lesson)`** — returns unified schoology object
4. **Migration function `migrateSchoologyFields(entry)`** — converts old 3-object format to new unified format (run once during migration)
5. **Validate folder URLs** — `updateUrl()` rejects malformed URLs (double `?f=`)
6. **`updateSchoologyMaterial(unit, lesson, type, materialData)`** — update a single material within `schoology.materials`

**Migration script** (`scripts/migrate-registry-schoology.mjs`):
- Reads every entry in the registry
- For each entry with `schoology` or `schoologyLinks`:
  - Merges data into the unified format
  - Picks the most authoritative source for each field
  - Cleans up malformed folder URLs
  - Removes deprecated `schoologyLinks` and old `schoology` fields
- Writes migrated registry
- Prints migration report

### Phase 4: Supabase Registry (optional, future)

Move the lesson registry from `state/lesson-registry.json` to a Supabase `lessons` table.

**Table schema:**
```sql
CREATE TABLE lessons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unit INT NOT NULL,
  lesson INT NOT NULL,
  topic TEXT,
  date DATE,
  period TEXT,
  urls JSONB DEFAULT '{}',
  status JSONB DEFAULT '{}',
  schoology JSONB DEFAULT '{}',
  timestamps JSONB DEFAULT '{}',
  machine_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (unit, lesson)
);

CREATE INDEX idx_lessons_unit_lesson ON lessons(unit, lesson);
```

**Not in scope for this spec** — Phase 4 is a future enhancement. Phases 1-3 solve the immediate problems with the local JSON registry.

---

## Dependency Graph

```
Phase 1: Deep Scraper
  └── depends on: cdp-connect.mjs, schoology-dom.mjs (existing)
  └── output: state/schoology-tree.json

Phase 2: Reconciliation Engine
  ├── depends on: Phase 1 output (schoology-tree.json)
  ├── depends on: lesson-registry.mjs (existing, read-only)
  └── output: state/reconciliation-report.json

Phase 3a: Registry Migration Script
  ├── depends on: lesson-registry.mjs (existing)
  └── output: migrated state/lesson-registry.json

Phase 3b: Registry API Hardening
  ├── depends on: Phase 3a (migration defines new shape)
  └── output: updated lesson-registry.mjs

Phase 3c: Pipeline Integration
  ├── depends on: Phase 2 (reconcile after posting)
  ├── depends on: Phase 3b (new registry API)
  └── output: updated post-to-schoology.mjs, lesson-prep.mjs
```

**Parallelizable**: Phase 1 and Phase 3a can run in parallel (no dependencies).
Phase 2 and Phase 3b can run in parallel once Phase 1 and Phase 3a are done.

---

## Implementation Waves

### Wave 1 (parallel)
- **1A**: `scripts/schoology-deep-scrape.mjs` — Deep recursive scraper
- **1B**: `scripts/migrate-registry-schoology.mjs` — Registry migration script

### Wave 2 (parallel, after Wave 1)
- **2A**: `scripts/lib/schoology-reconcile.mjs` — Reconciliation library
- **2B**: `scripts/lib/lesson-registry.mjs` — API hardening (new functions, URL validation)

### Wave 3 (after Wave 2)
- **3A**: `scripts/schoology-reconcile.mjs` — Reconciliation CLI
- **3B**: Pipeline integration — post-to-schoology.mjs stores unified schoology state, lesson-prep.mjs runs reconciliation after posting

### Wave 4 (after Wave 3)
- **4A**: Dashboard integration — reconciliation report view in dashboard
- **4B**: Automated nightly reconciliation (cron or pipeline step)

---

## File Manifest

| File | Type | Wave | Description |
|------|------|------|-------------|
| `scripts/schoology-deep-scrape.mjs` | NEW | 1A | Recursive CDP scraper |
| `scripts/migrate-registry-schoology.mjs` | NEW | 1B | One-time registry migration |
| `scripts/lib/schoology-reconcile.mjs` | NEW | 2A | Pure reconciliation engine |
| `scripts/lib/lesson-registry.mjs` | MODIFY | 2B | New functions, URL validation |
| `scripts/schoology-reconcile.mjs` | NEW | 3A | CLI for reconciliation |
| `scripts/post-to-schoology.mjs` | MODIFY | 3B | Store unified schoology state |
| `scripts/lesson-prep.mjs` | MODIFY | 3B | Run reconciliation after posting |
| `state/schoology-tree.json` | OUTPUT | — | Deep scrape output |
| `state/reconciliation-report.json` | OUTPUT | — | Reconciliation diff |

---

## Existing Code to Reuse

| Module | Functions to Import | Used By |
|--------|-------------------|---------|
| `lib/cdp-connect.mjs` | `connectCDP()` | Deep scraper |
| `lib/schoology-dom.mjs` | `navigateToFolder()`, `listItems()`, `COURSE_IDS`, `materialsUrl()` | Deep scraper |
| `sync-schoology-to-registry.mjs` | `parseTopicFromTitle()`, `classifyMaterial()` | Deep scraper, reconciliation |
| `lib/schoology-heal.mjs` | `buildExpectedLinks()` | Reconciliation |
| `lib/lesson-registry.mjs` | `loadRegistry()`, `getLesson()`, `URL_KEYS`, `STATUS_KEYS` | All phases |

**Important**: `parseTopicFromTitle()` and `classifyMaterial()` should be extracted to a shared `lib/schoology-classify.mjs` module in Wave 1 so both the deep scraper and reconciliation engine can import them without pulling in the full sync script.

---

## DOM Selectors Reference (for CDP scraping)

| Element | Selector | Notes |
|---------|----------|-------|
| Folder rows | `tr[id^="f-"]` | ID format: `f-{numericId}` |
| Material rows | `tr[id^="n-"]` or `tr[id^="s-"]` | Both patterns exist |
| Folder title | `div.folder-title a` or `.item-title a` | |
| Material title | `a.gen-post-link` or `.item-title a` | |
| Material type | CSS class: `type-document`, `type-discussion`, etc. | |
| Material link | `a.gen-post-link[href]` | Actual Schoology view URL |
| Folder contents table | `#folder-contents-table` | |

---

## Success Criteria

1. `node scripts/schoology-deep-scrape.mjs` produces a complete tree of all folders and materials in the course
2. `node scripts/schoology-reconcile.mjs` diffs registry vs tree and reports every mismatch
3. `node scripts/schoology-reconcile.mjs --unit 6 --lesson 4` shows that 6.4's materials are in the wrong folder
4. Registry migration script converts all entries to the unified `schoology` format without data loss
5. `urls.schoologyFolder` with malformed URLs are rejected/cleaned
6. After a full pipeline run, `schoology-reconcile` reports zero issues for that lesson
7. The dashboard can display reconciliation reports (stretch goal)
