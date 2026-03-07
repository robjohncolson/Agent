# Agent: Blooket Shared Helpers

Create `scripts/lib/blooket-helpers.mjs` — a shared utility module for all Blooket CDP automation scripts.

## Context

All Blooket scripts (`upload-blooket.mjs`, `find-blooket-set.mjs`, `delete-blooket-sets.mjs`) share the same CDP patterns that were copy-pasted and debugged independently. This module extracts the battle-tested versions.

The existing CDP connection library is `scripts/lib/cdp-connect.mjs` — follow its style (named exports, JSDoc, no TypeScript).

## Hard Constraints

- Modify/create ONLY: `scripts/lib/blooket-helpers.mjs`
- Do NOT modify any other scripts — consumer agents will import from this module separately.
- All functions must accept a Playwright `page` object as the first argument.
- Use ES module syntax (`export function`).
- No new dependencies beyond Playwright (already installed).

## Deliverables

Export these four functions:

### 1. `dismissCookieBanner(page)`
- Click `button.cky-btn-accept` if present.
- Swallow errors silently if no banner exists.
- Wait 500ms after click.

### 2. `scrollToLoadAll(page, { maxIterations = 20, scrollStep = 400, settleMs = 300 } = {})`
- Scroll down by `scrollStep` pixels repeatedly.
- After each scroll, wait `settleMs` then compare `document.body.scrollHeight` to previous value.
- Stop early if scrollHeight hasn't changed for 2 consecutive iterations (content fully loaded).
- Stop at `maxIterations` regardless.
- Scroll back to top when done.
- Return `{ scrollHeight, iterations }`.

### 3. `confirmModal(page, expectedText, { timeoutMs = 3000 } = {})`
- Wait up to `timeoutMs` for a visible element matching `[class*="_modal"]` whose `.textContent` includes `expectedText`.
- If found, click the element with text `"Yes"` inside that modal.
- If modal text does NOT contain `expectedText`, click `"No"` to cancel and return `{ confirmed: false, modalText }`.
- If no modal appears within timeout, return `{ confirmed: false, modalText: null }`.
- On success, wait 2000ms for the page to settle, return `{ confirmed: true, modalText }`.

### 4. `findSetContainer(page, setId)`
- Find `a[href="/set/${setId}"]` on the page.
- Walk up the DOM tree to find the ancestor with class containing `_setContainer`.
- Call `scrollIntoViewIfNeeded()` on it.
- Return the Playwright `ElementHandle`, or `null` if not found.

## Style

```js
// Example usage pattern consumers will follow:
import { dismissCookieBanner, scrollToLoadAll, confirmModal, findSetContainer } from "./lib/blooket-helpers.mjs";

const { browser, page } = await connectCDP(chromium, { preferUrl: "blooket.com" });
await dismissCookieBanner(page);
await scrollToLoadAll(page);
const container = await findSetContainer(page, "69aa45856790eef16f71aebb");
```
