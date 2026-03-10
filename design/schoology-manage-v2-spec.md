# schoology-manage.mjs v2 — Full Folder Management CLI

**Author**: Agent (2026-03-09)
**Status**: In Progress
**Replaces**: `scripts/schoology-manage.mjs` (v1, rough selectors), `scripts/schoology-workahead.mjs` (one-off)

---

## Problem

We have two overlapping Schoology automation scripts:
- `schoology-manage.mjs` — generic but uses guesswork selectors that don't reliably work
- `schoology-workahead.mjs` — one-off script with **battle-tested selectors** discovered through live probing

We need to consolidate into a single, robust CLI that can manage the entire Schoology folder tree.

## Architecture

```
scripts/
  lib/
    schoology-dom.mjs     ← NEW: shared DOM interaction helpers (proven selectors)
  schoology-manage.mjs    ← REWRITE: CLI entrypoint with all commands
  schoology-workahead.mjs ← DELETE after consolidation
```

### Shared DOM Helper: `scripts/lib/schoology-dom.mjs`

Extracts all proven Schoology DOM patterns into reusable async functions. Every function takes a Playwright `page` object.

```js
// Navigation
navigateToFolder(page, courseId, folderId?)  // null folderId = top level
ensureMaterialsPage(page, courseId)

// Waiting
sleep(ms)
waitForPopup(page, timeout?)       // polls for .popups-box visible
waitForPopupClose(page, timeout?)  // polls for .popups-box gone (handles navigation destroy)

// Reading
listItems(page)           // returns [{id, name, type:'folder'|'link', color?, href}]
findFolderByName(page, name)  // returns {id, name, href} or null
findFolderById(page, id)

// Folder creation
clickAddMaterials(page)    // clicks the "Add Materials" span
clickAddFolder(page)       // clicks "Add Folder" link in dropdown
fillFolderForm(page, {name, color?})  // fills #edit-title, clicks color swatch
submitPopup(page)          // clicks #edit-submit, waits for close

// Folder move
openGearMenu(page, rowId)        // clicks .action-links-unfold on the row
clickMoveOption(page, rowId)     // clicks a.move-material on the row
selectMoveTarget(page, targetName) // finds option in #edit-destination-folder select
submitMovePopup(page)            // clicks submit in move popup

// Link posting
clickAddFileLink(page)     // clicks "Add File/Link/External Tool"
clickLinkOption(page)      // clicks a.action-create-link
fillLinkForm(page, {title, url})  // fills #edit-link and #edit-link-title
```

### Proven Selectors (from live probing)

| Element | Selector | Notes |
|---------|----------|-------|
| Folder rows | `tr[id^="f-"]` | ID format: `f-{numericId}` |
| Link rows | `tr[id^="n-"]` | ID format: `n-{numericId}` |
| Folder name link | `.item-title a, td a` | First match in row |
| Folder color | `span.folder-icon.folder-color-{color}` | blue, red, orange, yellow, green, purple, pink, black, gray |
| Gear icon | `.action-links-unfold` | Inside folder row |
| Move link | `a.move-material` | Inside gear dropdown, class `popups-processed` |
| Move target dropdown | `#edit-destination-folder` | `<select>` with `name="destination_folder"` |
| Move dropdown options | Indented with `--` per nesting level | `(None)` = top level (value `0`) |
| Add Materials | `span` with text "Add Materials" | No stable selector, use text match |
| Add Folder | `a` with text "Add Folder" | In dropdown after Add Materials |
| Folder title input | `#edit-title` | In popup form |
| Folder color input | `#edit-folder-color` (hidden) | Value: 0=blue, 1=red, 2=orange, 3=yellow, 4=green, 5=purple, 6=pink |
| Color swatches | `div.s-js-color-select[data-color="{color}"]` | Click to select; `data-value` matches hidden input |
| Popup container | `.popups-box` | Check `style.display` and `offsetParent` |
| Submit button | `#edit-submit` | Universal across create/edit/move popups |
| Add File/Link | `a` with text containing "File/Link/External Tool" | In Add Materials dropdown |
| Link option | `a.action-create-link` | Or fallback: `a` with text "Link" |
| Link URL input | `#edit-link` | In link creation popup |
| Link title input | `#edit-link-title` | In link creation popup |
| Materials table | `#folder-contents-table > tbody > tr` | All rows including spacers |
| Materials URL | `/course/{courseId}/materials` | `?f={folderId}` for subfolder |

---

## CLI Commands

### `list [--in <folder>] [--recursive]`

List folders and links at a given level.

```bash
# Top-level folders
node scripts/schoology-manage.mjs list

# Inside a specific folder (by name or ID)
node scripts/schoology-manage.mjs list --in "work-ahead/future"
node scripts/schoology-manage.mjs list --in 986892037

# Recursive tree view
node scripts/schoology-manage.mjs list --recursive
node scripts/schoology-manage.mjs list --in "Q3" --recursive
```

Output:
```
Schoology Materials — 6 folder(s), 4 link(s):

  [folder] [986892037] work-ahead/future (red)
  [folder] [986776304] week 25
  [folder] [986332512] Week 24
  [folder] [979668509] Q3
  [folder] [979668499] S2
  [folder] [970440172] S1
  [link]   [8285631546] CALENDAR (now to end of year)
  [link]   [8190047403] Math Practice Website
  [link]   [8030207900] apStat Consensus-based quizzes!
  [link]   [8046218933] After School Help
```

### `create-folder <name> [--in <parent>] [--color <color>]`

Create a folder. If `--in` is omitted, creates at top level.

```bash
# Top-level, default blue
node scripts/schoology-manage.mjs create-folder "Week 26"

# Inside a parent, with color
node scripts/schoology-manage.mjs create-folder "Friday 3/27/26" --in "work-ahead/future" --color green

# Nested parent reference
node scripts/schoology-manage.mjs create-folder "Wednesday" --in "week 25"
```

Colors: blue (default), red, orange, yellow, green, purple, pink, black, gray

### `move-folder <name> --into <target> [--from <parent>]`

Move a folder into another folder. `--from` specifies where to find the source folder (defaults to current/top level).

```bash
# Move from top level
node scripts/schoology-manage.mjs move-folder "week 25" --into "work-ahead/future"

# Move from a nested location
node scripts/schoology-manage.mjs move-folder "Thursday 3/19/26" --into "work-ahead/future" --from "week 25"
```

The move uses the gear menu workflow:
1. Navigate to the source folder's parent
2. Click gear icon (`.action-links-unfold`) on the source row
3. Click "Move" (`a.move-material`)
4. In the popup, select target from `#edit-destination-folder` dropdown
5. Click submit

### `post-link <title> <url> [--in <folder>]`

Post a link material into a folder.

```bash
node scripts/schoology-manage.mjs post-link "Live Worksheet — 7.2" \
  "https://robjohncolson.github.io/apstats-live-worksheet/u7_lesson2_live.html" \
  --in "Friday 3/20/26"
```

Workflow: Add Materials → Add File/Link/External Tool → Link → fill `#edit-link` + `#edit-link-title` → submit.

### `tree [--depth <n>]`

Show full recursive folder tree from top level.

```bash
node scripts/schoology-manage.mjs tree
node scripts/schoology-manage.mjs tree --depth 2
```

Output:
```
AP Statistics B — Folder Tree:

├── S1/
│   ├── Q1/
│   │   ├── Week 6/
│   │   │   ├── Friday (October 10th, 2025)/
│   │   │   ├── Monday (October 6th, 2025)/
│   ...
├── work-ahead/future/ (red)
│   ├── Thursday 3/19/26/
│   ├── Friday 3/20/26/
│   │   ├── [link] Live Worksheet — 7.2
│   │   ├── [link] Drills — 7.2
│   │   ├── [link] Quiz — 7.2
│   │   └── [link] Blooket — 7.2
│   └── week 25/
│       ├── Monday 3/16/26/
│       └── Tuesday 3/17/26/
```

---

## Constants

```js
const COURSE_ID = "7945275782";  // Period B
const MATERIALS_URL = `https://lynnschools.schoology.com/course/${COURSE_ID}/materials`;
const VALID_COLORS = ["blue","red","orange","yellow","green","purple","pink","black","gray"];
const COLOR_VALUES = { blue:0, red:1, orange:2, yellow:3, green:4, purple:5, pink:6, black:7, gray:8 };
```

---

## Error Handling

- If a folder name isn't found, print available folders at that level and exit
- If the move target isn't in the dropdown, print all dropdown options and exit
- If the popup doesn't appear within 10s, print the current page state and exit
- All `page.evaluate()` calls use native DOM selectors (no `:has-text()` — that's Playwright-only)
- `waitForPopupClose` catches navigation-destroyed context errors (proven pattern)
- After each link post, re-navigate into the target folder (page may redirect after submit)

---

## Dependencies

- `playwright` (already installed)
- `scripts/lib/cdp-connect.mjs` (existing, unchanged)

## Cleanup

After consolidation, delete:
- `scripts/schoology-workahead.mjs`
