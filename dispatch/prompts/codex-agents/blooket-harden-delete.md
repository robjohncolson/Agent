# Agent: Harden delete-blooket-sets.mjs

Refactor `scripts/delete-blooket-sets.mjs` to use the shared helpers from `scripts/lib/blooket-helpers.mjs`.

## Context

This script was written through trial-and-error during a live debugging session. The working version uses pixel-level mouse clicks and inline DOM traversal. It should be cleaned up to use the shared helper module.

## Hard Constraints

- Modify ONLY: `scripts/delete-blooket-sets.mjs`
- DEPENDS ON `scripts/lib/blooket-helpers.mjs` existing (created by the `blooket-shared-helpers` agent).
- Import: `import { dismissCookieBanner, scrollToLoadAll, confirmModal, findSetContainer } from "./lib/blooket-helpers.mjs";`
- Do NOT modify any other files.

## Key Behaviors to Preserve

The current working flow is:

1. For each set ID, navigate fresh to `https://dashboard.blooket.com/my-sets` (avoids stale DOM).
2. Dismiss cookie banner.
3. Scroll to load all sets.
4. Find `a[href="/set/{setId}"]`, walk up to `_setContainer` ancestor.
5. Get the bounding box of the `i.fa-trash-alt` trash icon inside that container.
6. Use `page.mouse.click(x, y)` on the trash icon center — NOT `el.click()` via evaluate (evaluate click didn't trigger the modal).
7. Confirm the modal says "delete this set" (NOT "delete this folder").
8. Click "Yes" INSIDE the modal element specifically.
9. Wait 2s for deletion to complete.

## Deliverables

### 1. Refactor using shared helpers

Replace inline implementations with:
- `dismissCookieBanner(page)` — replaces the try/catch cookie block
- `scrollToLoadAll(page)` — replaces the hardcoded scroll loop
- `findSetContainer(page, setId)` — replaces the link-find + parent-walk logic
- `confirmModal(page, "delete this set")` — replaces the inline modal detection + Yes click

### 2. Keep the pixel-click pattern for the trash icon

The trash icon click MUST use `page.mouse.click()` with bounding box coordinates. This is the one pattern that cannot be delegated to a helper because `el.click()` via evaluate doesn't trigger the Blooket modal. The helper `findSetContainer` returns the container, then this script gets the trash icon bbox from it.

```js
const container = await findSetContainer(page, setId);
const trashBox = await container.evaluate(el => {
  const trash = el.querySelector('i.fa-trash-alt');
  if (!trash) return null;
  const rect = (trash.parentElement || trash).getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
});
await page.mouse.click(trashBox.x, trashBox.y);
```

### 3. Clean up the file header/usage comment

```
Usage:
  node scripts/delete-blooket-sets.mjs <setId1> [setId2] ...

Example:
  node scripts/delete-blooket-sets.mjs 69aa4161572efa156e0d998c 69aa42656790eef16f71addb
```

### 4. Error handling

- If `findSetContainer` returns null, log "Set {id} not found on page" and continue to next.
- If trash icon has no bounding box, log and continue.
- If `confirmModal` returns `{ confirmed: false }`, log the modal text and continue.
- Never crash on a single set failure — always try remaining sets.
