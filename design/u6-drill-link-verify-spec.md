# Unit 6 Drill Link Verification & Repair Spec

## Problem

After a U6 cartridge mode reorder (commit `503de51`) and animation dedup (commits `bf084eb`, `5ffd0fc`), drill links in Schoology may point to wrong or stale URLs. Additionally, the `schoology-tree.json` scrape and registry show significant coverage gaps:

**Period B (course 7945275782):**
- Only 6.4 and 6.5 confirmed in schoology-tree
- 6.1–6.3 and 6.6–6.11 drill links may be missing or unverified

**Period E (course 7945275798):**
- Has materials for 6.3–6.11 (9 entries)
- Missing 6.1 and 6.2 drill links entirely
- Duplicate 6.11 entry (IDs 8288287536 and 8288418715)

The mode reorder moved 6.4g-j before capstone, but drill URLs use `&level=LEVEL_ID` (not `&mode=N`), so the reorder *should* be safe. We need to verify this assumption and repair any gaps.

## Correct Drill URLs (source of truth)

All URLs point to the **first mode** of each topic in the `apstats-u6-inference-prop` cartridge:

| Lesson | Level ID | URL |
|--------|----------|-----|
| 6.1 | `l01-identify-evidence` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l01-identify-evidence` |
| 6.2 | `l04-identify-procedure` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l04-identify-procedure` |
| 6.3 | `l12-interpret-ci` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l12-interpret-ci` |
| 6.4 | `l17-state-null` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l17-state-null` |
| 6.5 | `l24-test-statistic` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l24-test-statistic` |
| 6.6 | `l29-compare-pvalue-alpha` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l29-compare-pvalue-alpha` |
| 6.7 | `l35-identify-error-type` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l35-identify-error-type` |
| 6.8 | `l44-identify-two-prop-ci` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l44-identify-two-prop-ci` |
| 6.9 | `l49-interpret-two-prop-claim-interval` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l49-interpret-two-prop-claim-interval` |
| 6.10 | `l17-hypotheses-610` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l17-hypotheses-610` |
| 6.11 | `l21-test-statistic-611` | `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l21-test-statistic-611` |

## Existing Infrastructure

| Module | Role |
|--------|------|
| `scripts/post-to-schoology.mjs` | CLI for posting links via CDP; supports `--heal`, `--courses`, `--only drills` |
| `scripts/lib/schoology-heal.mjs` | `auditSchoologyFolder()` — title-match audit; `deleteSchoologyLink()` — remove orphans |
| `scripts/lib/schoology-dom.mjs` | `listItems()`, `navigatePath()`, `navigateToFolder()` — DOM helpers |
| `scripts/lib/cdp-connect.mjs` | CDP connection to Edge on port 9222 |
| `scripts/lib/resolve-folder-path.mjs` | Date → quarter/week folder path resolution |
| `scripts/lib/lesson-registry.mjs` | Registry CRUD: `getSchoologyState()`, `updateSchoologyMaterial()`, `setSchoologyState()` |
| `state/lesson-registry.json` | Persistent registry — has all 11 U6 entries with `urls.drills` and `schoology[period].materials` |
| `state/schoology-tree.json` | Cached Schoology folder/material tree (last scrape: Period E) |
| `config/topic-schedule.json` | Per-period topic-to-date mapping (B + E) for folder resolution |

### Heal Mode (existing)

`post-to-schoology.mjs --heal` already does per-folder audit + repair:
1. Navigates to the lesson folder
2. Collects existing links via `auditSchoologyFolder()`
3. Matches expected links by **case-insensitive title**
4. Posts only missing links
5. Verifies each post
6. Updates registry per-link

### Limitation

Heal mode works **one lesson at a time** and requires a known folder URL. There is no batch-verify command that sweeps all 11 lessons across both periods.

## Design

### New Script: `scripts/verify-u6-drills.mjs`

A single-purpose verification and repair script for Unit 6 drill links across both periods.

#### CLI Interface

```bash
node scripts/verify-u6-drills.mjs [options]

Options:
  --dry-run         Report findings without making changes (default)
  --fix             Actually post missing links and delete duplicates
  --period <B|E>    Verify only one period (default: both)
  --lesson <N>      Verify only one lesson (default: 6.1–6.11)
  --verbose         Show per-link detail during scan
```

Default behavior is **dry-run** (read-only audit). `--fix` enables writes.

#### Algorithm

```
Phase 1: Registry Audit (no CDP needed)
  For each lesson 6.1–6.11:
    1. Load registry entry via getLesson(6, N)
    2. Check urls.drills matches the correct URL from the table above
    3. For each period (B, E):
       a. Check schoology[period].materials.drills exists
       b. Check it has a schoologyId (was actually posted)
       c. Check targetUrl matches correct drill URL (if stored)
       d. Flag: missing, wrong-url, unverified, or ok
    4. Check schoology[period].folderId exists (folder is known)
  Output: per-lesson, per-period status table

Phase 2: CDP Verification (requires Edge + CDP)
  Connect to Edge via cdp-connect.mjs
  For each period:
    For each lesson with a known folderId:
      1. Navigate to folder via navigateToFolder(page, courseId, folderId)
      2. Call listItems(page) to get all links in the folder
      3. Find drill link by title pattern: /drill/i or /Topic 6\.N.*Drill/i
      4. If found:
         a. Extract href from the DOM
         b. Navigate to the link's Schoology page to read the actual target URL
            (Schoology wraps external links — the real URL is in the link detail page)
         c. Compare target URL against correct drill URL
         d. Record: { schoologyId, title, targetUrl, matches: boolean }
      5. If not found: record as missing
  Output: per-lesson, per-period verification table with match/mismatch/missing

Phase 3: Repair (only with --fix)
  For each lesson flagged in Phase 2:
    Case: missing
      → Post drill link using postLink() into the correct folder
      → Title: "Topic 6.N — Drills"
      → URL: correct drill URL from table
      → Update registry via updateSchoologyMaterial()
    Case: wrong-url
      → Delete old link via deleteSchoologyLink(page, oldSchoologyId)
      → Post new link with correct URL
      → Update registry
    Case: duplicate (6.11 in Period E)
      → Keep the one with the correct URL (or the older one if both correct)
      → Delete the other via deleteSchoologyLink()
      → Update registry to remove duplicate reference
  Update registry status: updateStatus(6, N, "schoology", "done")

Phase 4: Summary Report
  Print table:
    Lesson | Period B | Period E | Action Taken
    6.1    | posted   | posted   | fix: posted both
    6.2    | ok       | posted   | fix: posted E
    ...
    6.11   | ok       | deduped  | fix: deleted duplicate

  If --dry-run: "Run with --fix to apply N changes"
```

#### Target URL Extraction

Schoology wraps external links. To read the actual destination URL:
1. Navigate to the link view page: `https://lynnschools.schoology.com/course/{courseId}/materials/link/view/{materialId}`
2. Look for the external link anchor in the page body (selector: `a.link-url` or the primary content link)
3. Extract `href` — this is the real target URL

If the link detail page is not accessible, fall back to the `targetUrl` stored in the registry (may be null for older entries).

#### Folder Discovery Fallback

If `schoology[period].folderId` is missing from the registry:
1. Use `resolveFolderPath(6, N, { period })` to compute expected folder path
2. Use `navigatePath(page, courseId, pathSegments, { createMissing: false })` to find the folder
3. If found, update registry with the discovered folderId
4. If not found, flag lesson as `no-folder` — skip verification, will need manual folder creation or `--heal` run

### Registry Updates

For each verified drill link:
```javascript
updateSchoologyMaterial(6, lesson, 'drills', {
  schoologyId: '<from DOM>',
  title: 'Topic 6.N — Drills',
  href: '<schoology view URL>',
  targetUrl: '<correct drill URL>',
  status: 'done',
  verified: true,
  postedAt: '<ISO timestamp if newly posted>',
}, period);
```

For registry `urls.drills` corrections (if wrong):
```javascript
updateUrl(6, lesson, 'drills', '<correct URL>');
```

### Title Matching

Drill links may have been posted with different title formats across periods:
- Period B (posted by pipeline): `Topic 6.N — Drills`
- Period E (posted manually or by earlier version): `Drills — 6.N`

Match using regex: `/drill/i` on the title, then confirm the lesson number appears.

## Scope

### In Scope
- Verify all 11 Unit 6 drill links in both Period B and Period E
- Fix missing drill links (post new)
- Fix wrong-URL drill links (delete + re-post)
- Remove duplicate 6.11 in Period E
- Update registry to reflect verified state
- Dry-run default for safety

### Out of Scope
- Other material types (worksheet, quiz, blooket, videos) — those can use `--heal` separately
- Units other than 6 — this is a targeted fix script
- Folder creation — assumes folders exist; flags missing folders for manual intervention
- Scraping full schoology-tree.json — uses existing tree + live CDP checks

## Execution Plan

### Step 1: Build script skeleton
- Parse CLI args (dry-run default, --fix, --period, --lesson, --verbose)
- Load registry, load correct URL table as constant
- Implement Phase 1 (registry audit — no CDP)

### Step 2: CDP verification
- Connect to Edge, iterate lessons × periods
- Navigate to each folder, find drill links, extract target URLs
- Build verification report

### Step 3: Repair logic
- Post missing, replace wrong-URL, deduplicate
- Registry updates after each action

### Step 4: Summary output
- Formatted table with per-lesson, per-period status
- Dry-run hint if no --fix

## Dependencies

- Edge browser running with `--remote-debugging-port=9222`
- Signed into Schoology in Edge
- Node v22+
- `playwright` (for CDP connection)

## Risks

| Risk | Mitigation |
|------|-----------|
| CDP session timeout during long sweep | Re-connect per period if needed; add retry on navigation failure |
| Schoology rate limiting | 3s delay between posts (existing convention in postLink) |
| Title mismatch false negatives | Use broad regex `/drill/i` + lesson number, not exact string match |
| Wrong link deleted | Log every delete with schoologyId + title before execution; dry-run default |
| Registry drift | Always read registry fresh before each write; use atomic update functions |
