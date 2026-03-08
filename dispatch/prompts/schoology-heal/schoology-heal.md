# Agent: schoology-heal

## Task

Create a new file `scripts/lib/schoology-heal.mjs` that provides Schoology link auditing and verification. This is the core "heal" logic: it checks what's already posted in a Schoology folder and reports what's missing or broken.

## File to create

`scripts/lib/schoology-heal.mjs` (NEW FILE)

## Dependencies

This module imports from:
- `./lesson-registry.mjs` — uses `computeUrls()` (exported at line 296) and `getLesson()`
- No circular imports — `post-to-schoology.mjs` will import FROM this file (one-way)

## Architecture

The heal flow:
1. `buildExpectedLinks(unit, lesson, opts)` — generates the full list of links that SHOULD be in the Schoology folder
2. `auditSchoologyFolder(page, folderUrl, expectedLinks)` — scrapes the folder DOM and diff against expected
3. `verifyPostedLink(page, title, folderUrl)` — confirms a single link exists after posting

## Exports to implement

### 1. `buildExpectedLinks(unit, lesson, opts)` — Build the canonical link list

Uses `computeUrls()` from lesson-registry.mjs and local `buildLinkTitles()` to generate what should be posted. Checks the registry for a Blooket URL. Returns an array of `{ key, title, url }` objects.

```js
import { computeUrls, getLesson } from "./lesson-registry.mjs";

function buildLinkTitles(unit, lesson) {
  return {
    worksheet: `Topic ${unit}.${lesson} — Follow-Along Worksheet`,
    drills: `Topic ${unit}.${lesson} — Drills`,
    quiz: `Quiz ${unit}.${lesson - 1}`,
    blooket: `Topic ${unit}.${lesson} — Blooket Review`,
  };
}

export function buildExpectedLinks(unit, lesson, opts = {}) {
  const urls = computeUrls(unit, lesson);
  const titles = buildLinkTitles(unit, lesson);
  const links = [];

  if (urls.worksheet) {
    links.push({ key: "worksheet", title: titles.worksheet, url: urls.worksheet });
  }
  if (urls.drills) {
    links.push({ key: "drills", title: titles.drills, url: urls.drills });
  }
  if (urls.quiz) {
    links.push({ key: "quiz", title: titles.quiz, url: urls.quiz });
  }

  // Blooket: from opts or registry
  const blooketUrl = opts.blooketUrl || getLesson(unit, lesson)?.urls?.blooket || null;
  if (blooketUrl) {
    links.push({ key: "blooket", title: titles.blooket, url: blooketUrl });
  }

  // Videos: if caller provides them
  if (Array.isArray(opts.videoLinks)) {
    for (const v of opts.videoLinks) {
      links.push({ key: v.key, title: v.title, url: v.url });
    }
  }

  return links;
}
```

### 2. `auditSchoologyFolder(page, folderUrl, expectedLinks)` — Scrape and diff

Navigates to the folder URL, collects existing links using the same DOM selectors from `scrape-schoology-urls.mjs:277-315` (inlined since that function isn't exported), then diffs against the expected list.

Returns `{ existing, missing, matched }`:

```js
export async function auditSchoologyFolder(page, folderUrl, expectedLinks) {
  await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Collect links from the folder DOM (same selectors as scrape-schoology-urls.mjs collectFolderLinks)
  const existing = await page.evaluate(() => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const output = [];
    const seen = new Set();

    const rows = document.querySelectorAll(
      'tr[id^="s-"], tr.material-row, .material-row'
    );

    for (const row of rows) {
      const anchors = row.querySelectorAll("a[href]");
      for (const anchor of anchors) {
        const href = anchor.href || anchor.getAttribute("href") || "";
        if (!href || href.startsWith("javascript:") || href === "#") {
          continue;
        }

        const title = clean(
          anchor.textContent ||
            anchor.getAttribute("title") ||
            row.querySelector(".item-title")?.textContent ||
            ""
        );

        if (!title) continue;

        const key = `${title}|${href}`;
        if (seen.has(key)) continue;
        seen.add(key);

        output.push({ title, url: href });
      }
    }

    return output;
  });

  // Match expected links against existing by title (case-insensitive, trimmed)
  const matched = [];
  const missing = [];

  for (const expected of expectedLinks) {
    const normalExpected = expected.title.toLowerCase().trim();
    const found = existing.find(
      (e) => e.title.toLowerCase().trim() === normalExpected
    );

    if (found) {
      matched.push({ ...expected, existingUrl: found.url });
    } else {
      missing.push(expected);
    }
  }

  return { existing, missing, matched };
}
```

### 3. `verifyPostedLink(page, title, folderUrl)` — Post-posting verification

After posting a link, verify it actually appears in the folder:

```js
export async function verifyPostedLink(page, title, folderUrl) {
  await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const found = await page.evaluate((searchTitle) => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const rows = document.querySelectorAll(
      'tr[id^="s-"], tr.material-row, .material-row'
    );

    for (const row of rows) {
      const anchors = row.querySelectorAll("a[href]");
      for (const anchor of anchors) {
        const title = clean(
          anchor.textContent ||
            anchor.getAttribute("title") ||
            row.querySelector(".item-title")?.textContent ||
            ""
        );
        if (title.toLowerCase().trim() === searchTitle.toLowerCase().trim()) {
          return true;
        }
      }
    }
    return false;
  }, title);

  return found;
}
```

## Full file structure

```js
/**
 * schoology-heal.mjs — Schoology folder auditing and link verification.
 *
 * Used by post-to-schoology.mjs --heal to detect missing/failed links
 * and selectively re-post only what's needed.
 */

import { computeUrls, getLesson } from "./lesson-registry.mjs";

function buildLinkTitles(unit, lesson) { ... }

export function buildExpectedLinks(unit, lesson, opts = {}) { ... }
export async function auditSchoologyFolder(page, folderUrl, expectedLinks) { ... }
export async function verifyPostedLink(page, title, folderUrl) { ... }
```

## Constraints

- This is a NEW file — do not modify any existing files
- Import `computeUrls` and `getLesson` from `./lesson-registry.mjs` only (no circular import to post-to-schoology.mjs)
- Inline the DOM scraping logic (don't try to import `collectFolderLinks` from scrape-schoology-urls.mjs — it's not exported)
- All 3 public functions must be named exports
- `buildLinkTitles()` is a private helper (not exported) — it duplicates the title patterns from `post-to-schoology.mjs:234-241` intentionally to avoid coupling

## Verification

```bash
node --check scripts/lib/schoology-heal.mjs
node -e "import('./scripts/lib/schoology-heal.mjs').then(m => { console.log(Object.keys(m).sort().join(', ')); })"
```

Expected output:
```
auditSchoologyFolder, buildExpectedLinks, verifyPostedLink
```
