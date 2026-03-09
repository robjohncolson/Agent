# Spec: `--heal` Orphan Cleanup

## Problem

When `post-to-schoology.mjs` crashes, times out, or runs without `--create-folder`, lesson links get dumped at the course root instead of inside a day folder. These "orphans" are visible to students, clutter the materials page, and create duplicates when the pipeline re-runs with the correct folder.

Currently `--heal` can discover folders and post missing links, but it has no way to clean up orphaned root-level links. Manual deletion (gear → Delete → confirm, 13 times) is tedious.

## Solution

Add orphan detection and deletion as default `--heal` behavior. When healing a lesson, scan the course root for links whose titles match that lesson's patterns, and delete any that are orphaned (i.e., the link already exists or will be posted inside the correct folder).

## Key Discovery (2026-03-08)

Schoology's options gear is a `div.action-links-unfold` with `role="button"`. Playwright's `.click()` hangs on it (30s timeout), but `page.evaluate(() => el.click())` works instantly. The deletion flow is:

1. `page.evaluate()` → click `div.action-links-unfold` inside the link's `<tr>` row
2. Wait for dropdown → find the "Delete" link in `ul.action-links-content`
3. `page.evaluate()` → click the Delete link
4. Wait for confirm dialog → find and click the confirm button (`input[value="Delete"]`)
5. Wait for DOM update

This pattern is consistent across all material types (links, folders, discussions).

## Changes (2 files)

### 1. `scripts/lib/schoology-heal.mjs` — Add `deleteSchoologyLink()` and `findOrphanedLinks()`

#### `deleteSchoologyLink(page, linkViewId)`

Reusable utility that deletes a single Schoology material by its link view ID.

```
deleteSchoologyLink(page, linkViewId)
  → { deleted: true } | { deleted: false, reason: string }
```

**Algorithm:**
1. Find `a[href*="/link/view/${linkViewId}"]` on the current page
2. Walk up to the containing `<tr>` row
3. Find `div.action-links-unfold` inside the row
4. `page.evaluate()` → click the gear (JS-dispatched click, not Playwright click)
5. Wait 1s for dropdown
6. `page.evaluate()` → find and click "Delete" link in dropdown
7. Wait 1.5s for confirm dialog
8. `page.evaluate()` → find and click confirm button
9. Wait 2s for DOM update
10. Return `{ deleted: true }`

If any step fails (element not found, dropdown doesn't appear), return `{ deleted: false, reason }` instead of throwing.

#### `findOrphanedLinks(page, unit, lesson, materialsRootUrl)`

Scans the course root for links that match a lesson's title patterns but are sitting outside any folder.

```
findOrphanedLinks(page, unit, lesson, materialsRootUrl)
  → [ { linkViewId, title, rowId }, ... ]
```

**Algorithm:**
1. Navigate to `materialsRootUrl`
2. Collect all `<tr>` rows at the root level that are NOT inside a folder (i.e., `tr[id^="s-"]` rows that are siblings of `tr[id^="f-"]` folder rows, not children)
3. For each root-level link row, extract the title and href
4. Check if the title matches any of the lesson's expected patterns:
   - `Topic {unit}.{lesson} — Follow-Along Worksheet`
   - `Topic {unit}.{lesson} — Drills`
   - `Quiz {unit}.{lesson - 1}`
   - `Topic {unit}.{lesson} — Blooket Review`
   - `Topic {unit}.{lesson} — AP Classroom Video *` (wildcard for video numbering)
5. For matches, extract the link view ID from the href (`/link/view/{id}`)
6. Return the list of orphaned links

Use `buildLinkTitles()` (already exists as a private helper) for pattern generation. Add a loose match mode that checks `title.includes(pattern)` for the video wildcard case.

### 2. `scripts/post-to-schoology.mjs` — Wire orphan cleanup into `--heal` flow

#### Current heal flow (after folder discovery patch):
```
1. Registry lookup for folder URL
2. DOM discovery fallback (discoverLessonFolder)
3. --target-folder / --create-folder
4. Audit folder → filter to missing links
5. Post missing links
```

#### New heal flow:
```
1. Registry lookup for folder URL
2. DOM discovery fallback (discoverLessonFolder)
3. --target-folder / --create-folder
4. Audit folder → filter to missing links
5. NEW: Scan root for orphaned links matching this lesson
6. NEW: Delete orphans (only those whose titles match links already in-folder or about to be posted)
7. Post missing links
```

**Orphan deletion safety rule:** Only delete a root-level orphan if:
- The same link title is already confirmed present inside the correct folder (from the audit in step 4), OR
- The same link title is in the "missing" list and will be posted into the folder in step 7

This means: if `--heal` finds an orphan at root but has no folder to post into (no folder discovered, no `--create-folder`), it does NOT delete the orphan. The orphan is the only copy — deleting it would lose data.

**Logging:**
```
[heal] Scanning root for orphaned links...
[heal] Found 4 orphan(s) at root level:
  [orphan] "Topic 6.10 — Drills" (id: 8285744950) — already in folder, deleting
  [orphan] "Quiz 6.9" (id: 8285744970) — already in folder, deleting
  [orphan] "Topic 6.10 — Blooket Review" (id: 8285744980) — will be posted to folder, deleting
  [orphan] "Topic 6.10 — Follow-Along Worksheet" (id: 8286072407) — already in folder, deleting
[heal] Deleted 4 orphan(s) from root.
```

**Import additions:**
```js
import { ..., deleteSchoologyLink, findOrphanedLinks } from "./lib/schoology-heal.mjs";
```

## Files touched

| File | Change |
|------|--------|
| `scripts/lib/schoology-heal.mjs` | +`deleteSchoologyLink()` (~30 lines), +`findOrphanedLinks()` (~35 lines) |
| `scripts/post-to-schoology.mjs` | +orphan scan/delete step in heal flow (~25 lines), +imports |

## Edge cases

1. **No folder found** — Orphans exist but `--heal` couldn't find or create a folder. Log warning, do NOT delete orphans (they're the only copy). Existing warning message handles this.

2. **Orphan title matches but URL differs** — Delete anyway. The title match means it's the same logical link; the URL in the folder (or about to be posted) is the canonical one.

3. **Multiple orphans with same title** — Delete all of them. This handles the duplicate scenario we saw (two copies of "Topic 6.10 — Drills" at root).

4. **Link is inside a folder, not at root** — `findOrphanedLinks` only scans root-level rows, so folder contents are never touched.

5. **Race condition: page reloads between scan and delete** — Each `deleteSchoologyLink` call navigates/reloads as needed. If a link disappears between scan and delete attempt, `deleteSchoologyLink` returns `{ deleted: false, reason: "not found" }` and we skip it.

## Verification

1. `node --check scripts/lib/schoology-heal.mjs`
2. `node --check scripts/post-to-schoology.mjs`
3. `node -e "import('./scripts/lib/schoology-heal.mjs').then(m => console.log(typeof m.deleteSchoologyLink, typeof m.findOrphanedLinks))"` → `function function`
4. End-to-end: Post links without `--create-folder` (creates orphans at root) → run `--heal --create-folder "Test Folder"` → orphans deleted, links posted into folder

## Non-goals

- Deleting orphaned folders (only links)
- Cleaning up links for lessons other than the one being healed
- Moving links between folders (delete + re-post achieves the same result)
