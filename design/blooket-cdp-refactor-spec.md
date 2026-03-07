# Blooket CDP Refactor Spec

**Date:** 2026-03-06
**Trigger:** The 6.5 Blooket recovery session exposed fragile DOM scraping, missing utilities, and throwaway probe scripts that should be consolidated.

---

## Problem Summary

1. **No way to find or delete Blooket sets programmatically.** The upload script (`upload-blooket.mjs`) creates sets but never records the resulting URL, and there was no script to search or manage existing sets.

2. **Cookie banner blocks automation.** Every CDP script that touches Blooket must independently dismiss the CookieYes banner before interacting with the page. This is duplicated (or forgotten) across scripts.

3. **Scrolling to load lazy content is ad-hoc.** The My Sets page lazy-loads set cards. Every script guesses how many scroll iterations it needs. There's no shared "scroll until no new content" utility.

4. **Modal confirmation handling was fragile.** Clicking "Yes" in a Blooket modal required pixel-level mouse clicks and careful scoping to avoid hitting folder-level "Delete" buttons elsewhere on the page. The winning pattern (find `_modal` element, confirm text, click "Yes" inside it) should be reusable.

5. **Probe scripts are throwaway clutter.** Six `probe-blooket-*.mjs` files were created for DOM discovery and are no longer needed.

---

## Proposed Changes

### 1. Add shared Blooket helpers to `scripts/lib/blooket-helpers.mjs`

Extract repeating patterns into a utility module:

- **`dismissCookieBanner(page)`** — Click `button.cky-btn-accept` if present. Already needed by `upload-blooket.mjs`, `find-blooket-set.mjs`, `delete-blooket-sets.mjs`.

- **`scrollToLoadAll(page, opts?)`** — Scroll to bottom repeatedly until `document.body.scrollHeight` stops growing, with a max iteration cap. Returns the final scroll height. Replaces the hardcoded `for (let i = 0; i < N; i++) scrollBy(...)` loops.

- **`confirmModal(page, expectedText)`** — Wait for a `[class*="_modal"]` to appear, verify its text contains `expectedText` (e.g. "delete this set"), click "Yes" inside it. Return `{ confirmed, modalText }`. If the text doesn't match, click "No" and return `{ confirmed: false }`.

- **`findSetContainer(page, setId)`** — Given a set ID, find `a[href="/set/{id}"]`, walk up to the `_setContainer` parent, scroll it into view, and return the ElementHandle. Returns null if not found.

### 2. Harden `delete-blooket-sets.mjs`

The working version should be cleaned up:

- Use the shared helpers above instead of inline logic.
- **Re-navigate between deletions** (already does this) to avoid stale DOM after a set card disappears.
- Use `page.mouse.click()` on the trash icon's bounding box — `el.click()` via evaluate didn't trigger the modal reliably.
- Validate the modal says "delete this set" (not "delete this folder") before confirming.

### 3. Harden `find-blooket-set.mjs`

- The set title scraping picked up garbled CSS text because it grabbed `.textContent` from containers that included `<style>` tags. Fix: extract title from a more specific child element (the set name text node), or strip `<style>` content before reading text.
- Add `--json` flag to output structured JSON (id, title, questionCount, url) for machine consumption by other scripts.

### 4. Record Blooket URLs in `upload-blooket.mjs`

After a successful upload, append the set URL + metadata to a simple JSON log file (e.g. `state/blooket-uploads.json`):

```json
{
  "unit": 6, "lesson": 5,
  "title": "AP Stats 6.5 p-Values Review",
  "url": "https://dashboard.blooket.com/set/69aa45856790eef16f71aebb",
  "createdAt": "2026-03-06T..."
}
```

This way, when the user loses a link, we can look it up locally before scraping the dashboard.

### 5. Delete probe scripts

Remove these one-off files that were only needed for DOM discovery:

- `scripts/probe-blooket-api.mjs`
- `scripts/probe-blooket-create.mjs`
- `scripts/probe-blooket-csv.mjs`
- `scripts/probe-blooket-csv2.mjs`
- `scripts/probe-blooket-delete.mjs`
- `scripts/probe-blooket-mysets.mjs`
- `scripts/probe-blooket.mjs`

Keep `find-blooket-set.mjs` and `delete-blooket-sets.mjs` as permanent utilities.

### 6. Add `--only` flag to `post-to-schoology.mjs`

Currently you can post a single link by passing only `--blooket URL`, but the intent isn't obvious. Add an explicit `--only <type>` flag:

```bash
node scripts/post-to-schoology.mjs --unit 6 --lesson 5 --only blooket --blooket "URL"
```

This is syntactic sugar — the current behavior already works — but makes single-link posting a first-class documented use case rather than an accident of "you only provided one URL."

---

## Non-Goals

- **Blooket API reverse-engineering.** The REST API has no delete endpoint and the gRPC-web service uses protobuf encoding with CSRF tokens. CDP UI automation is the right approach for now.
- **Batch operations.** No need for "delete all sets matching X" — the simple `find` + `delete` workflow is sufficient.
- **Schoology changes.** The Schoology posting script worked fine on the first try. No refactor needed there.

---

## File Impact

| File | Action |
|---|---|
| `scripts/lib/blooket-helpers.mjs` | **New** — shared utilities |
| `scripts/delete-blooket-sets.mjs` | Refactor to use helpers |
| `scripts/find-blooket-set.mjs` | Fix title scraping, add `--json` |
| `scripts/upload-blooket.mjs` | Add URL logging to state |
| `scripts/post-to-schoology.mjs` | Add `--only` flag |
| `state/blooket-uploads.json` | **New** — upload history log |
| `scripts/probe-blooket*.mjs` (7 files) | **Delete** |
