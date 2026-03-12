# Agent C — Main Verification Script (CC-direct)

## Task

Build `scripts/verify-u6-drills.mjs` — the main CLI script that verifies and repairs Unit 6 drill links in Schoology across both periods.

## Owned Files

- `scripts/verify-u6-drills.mjs` (create)

## Dependencies (from Wave 1)

- `scripts/lib/drill-url-table.mjs` — `getCorrectDrillUrl`, `isDrillTitle`, `drillTitle`, `DRILL_BASE_URL`
- `scripts/lib/drill-verify-report.mjs` — `printRegistryAudit`, `printVerificationReport`, `printSummary`

## Existing Infrastructure

- `scripts/lib/cdp-connect.mjs` — `connectCDP(chromium, { preferUrl })`
- `scripts/lib/schoology-dom.mjs` — `navigateToFolder(page, courseId, folderId)`, `listItems(page)`, `navigatePath(page, courseId, segments, opts)`, `materialsUrl(courseId, folderId)`, `COURSE_IDS`, `clickAddMaterials`, `clickAddFileLink`, `clickLinkOption`, `fillLinkForm`, `submitPopup`, `sleep`
- `scripts/lib/schoology-heal.mjs` — `deleteSchoologyLink(page, linkViewId)`, `buildExpectedLinks(unit, lesson)`
- `scripts/lib/lesson-registry.mjs` — `getLesson`, `loadRegistry`, `getSchoologyState`, `updateSchoologyMaterial`, `updateStatus`, `updateUrl`
- `scripts/lib/resolve-folder-path.mjs` — `resolveFolderPath(unit, lesson, { period })`

## CLI Interface

```bash
node scripts/verify-u6-drills.mjs [options]
  --dry-run       Read-only audit (default)
  --fix           Post missing, replace wrong, deduplicate
  --period <B|E>  One period only (default: both)
  --lesson <N>    One lesson only (default: 6.1–6.11)
  --verbose       Per-link detail
```

## Algorithm (4 phases)

### Phase 1: Registry Audit (no CDP)
For lessons 6.1–6.11:
1. `getLesson(6, N)` — load entry
2. Compare `entry.urls.drills` against `getCorrectDrillUrl(N)`
3. For each period [B, E]:
   - `getSchoologyState(6, N, period)` → check `.materials.drills` exists
   - Check `.materials.drills.schoologyId` is set
   - Check `.materials.drills.targetUrl` matches correct URL
   - Classify: `ok`, `missing`, `wrong-url`, `unverified`, `no-folder`
4. `printRegistryAudit(results)`

### Phase 2: CDP Verification (requires Edge)
Connect via `connectCDP(chromium, { preferUrl: 'schoology.com' })`
For each period → each lesson with known folderId:
1. `navigateToFolder(page, COURSE_IDS[period], folderId)`
2. `listItems(page)` → find drill link using `isDrillTitle(item.name, lessonNum)`
3. If found: navigate to link detail page to extract target URL
   - URL: `https://lynnschools.schoology.com/course/{courseId}/materials/link/view/{materialId}`
   - Look for the external link: `page.evaluate()` to find `a.link-url` or primary content link href
4. Compare against `getCorrectDrillUrl(N)`
5. `printVerificationReport(results)`

### Phase 3: Repair (only with --fix)
For each flagged lesson:
- **missing**: Post using `postLink()` flow:
  1. `navigateToFolder(page, courseId, folderId)`
  2. `clickAddMaterials(page)`
  3. `clickAddFileLink(page)`
  4. `clickLinkOption(page)`
  5. `fillLinkForm(page, { title: drillTitle(N), url: getCorrectDrillUrl(N) })`
  6. `submitPopup(page)`
  7. `updateSchoologyMaterial(6, N, 'drills', { schoologyId, title, targetUrl, ... }, period)`
- **wrong-url**: `deleteSchoologyLink(page, oldId)` then post new
- **duplicate** (6.11 Period E): keep correct, delete other via `deleteSchoologyLink()`
- After each repair: 3s delay (`sleep(3000)`)

### Phase 4: Summary
`printSummary(results, { dryRun, fixCount })`

## Folder Discovery Fallback
If `folderId` missing from registry:
1. `resolveFolderPath(6, N, { period })` → path segments
2. `navigatePath(page, courseId, segments, { createMissing: false })` → folderId
3. Update registry if found; skip with `no-folder` if not

## Key Details

- COURSE_IDS: `{ B: '7945275782', E: '7945275798' }` (from schoology-dom.mjs)
- Playwright is dynamically imported: `const { chromium } = await import('playwright')`
- 3s delay between posts (existing convention)
- Always re-read registry before each write (it's file-based)
- Use `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` at top (corporate proxy)

## Acceptance Criteria

- [ ] `--dry-run` (default) produces Phase 1 + 2 + 4 output with no writes
- [ ] `--fix` posts missing links, deletes wrong ones, deduplicates 6.11
- [ ] `--period E` limits to Period E only
- [ ] `--lesson 3` limits to lesson 6.3 only
- [ ] Registry is updated after each repair action
- [ ] Script exits cleanly and disconnects CDP
