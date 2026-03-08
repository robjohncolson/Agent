# Spec: Fix Blooket Upload Failure + Schoology Stdin Timeout

## Problem Summary

Two failures occurred during the 6.11 pipeline run:

1. **Blooket upload fails** — `upload-blooket.mjs` cannot find the "Spreadsheet Import" button on the Blooket edit page after creating a set.
2. **Schoology posting times out** — When Blooket upload fails, `post-to-schoology.mjs` tries to auto-upload again (also fails), then falls back to `promptUser("Enter Blooket URL")` which blocks on stdin and hits `ETIMEDOUT` since the pipeline runs non-interactively via `execSync`.

## Root Cause Analysis

### Failure 1: "Spreadsheet Import" button not found

**Location:** `scripts/upload-blooket.mjs`, line 185

```js
const importBtn = await page.$('div:has-text("Spreadsheet Import")');
```

**Why it fails:** Blooket's UI has changed. The selector `div:has-text("Spreadsheet Import")` is brittle because:
- Blooket uses obfuscated CSS class names (e.g. `_setContainer_`, `_modal_`)
- The button may no longer be a `div`, or the text may have changed
- The `has-text` pseudo-selector matches ANY ancestor div containing that text, which can match the wrong element or fail if the text is in a different tag

**The real flow has shifted:** The current upload-blooket.mjs assumes a two-page flow:
1. `/create` page → fill title, select "CSV Upload" radio, click "Create Set"
2. Redirect to `/edit?id=xxx` → click "Spreadsheet Import" → upload file

But Blooket may now handle CSV upload differently — possibly all on the `/create` page, or with a different button name/location on the edit page.

### Failure 2: Schoology stdin timeout

**Location:** `scripts/post-to-schoology.mjs`, line 532

```js
const blooketInput = await promptUser("Enter Blooket URL (or press Enter to skip): ");
```

**Why it fails:** `lesson-prep.mjs` calls `post-to-schoology.mjs` via `execSync`, which means stdin is inherited from the parent process. But when the pipeline is run from the TUI menu (or any automated context), readline waits indefinitely for input, eventually hitting the OS-level `ETIMEDOUT` on the spawned process.

## Fix Plan

### Fix 1: Resilient Blooket upload selectors (`upload-blooket.mjs`)

**Strategy:** Replace the single brittle selector with a multi-strategy approach that tries several selectors and includes DOM inspection for debugging.

#### Changes to `uploadBlooket()` function (lines 169-212):

**A. Add a `findButton()` helper** that tries multiple selector strategies in order:

```js
async function findButton(page, strategies, label) {
  for (const { selector, description } of strategies) {
    const el = await page.$(selector);
    if (el) {
      console.log(`  Found "${label}" via: ${description}`);
      return el;
    }
  }
  return null;
}
```

**B. Replace the "Spreadsheet Import" button search** (line 185) with:

```js
const importStrategies = [
  { selector: 'button:has-text("Spreadsheet Import")', description: "button text match" },
  { selector: 'div[class*="import"i]:has-text("Spreadsheet")', description: "div class+text" },
  { selector: '[class*="import"i]', description: "class contains import" },
  { selector: ':text("Spreadsheet Import")', description: "any element text" },
  { selector: 'button:has-text("Import")', description: "button Import fallback" },
  { selector: 'div:has-text("Spreadsheet Import")', description: "div text (original)" },
];

const importBtn = await findButton(page, importStrategies, "Spreadsheet Import");
```

**C. Add DOM dump on failure** — if no selector matches, dump visible text and clickable elements for debugging:

```js
if (!importBtn) {
  const debugInfo = await page.evaluate(() => ({
    url: location.href,
    visibleText: document.body.innerText.substring(0, 500),
    buttons: [...document.querySelectorAll('button, [role="button"], div[class*="button"i]')]
      .slice(0, 15)
      .map(el => ({
        tag: el.tagName,
        text: el.innerText.trim().substring(0, 60),
        classes: el.className.substring(0, 80),
      })),
  }));
  console.error("\n  DEBUG: Page state when button not found:");
  console.error("  URL:", debugInfo.url);
  console.error("  Visible text:", debugInfo.visibleText);
  console.error("  Buttons found:", JSON.stringify(debugInfo.buttons, null, 2));
  throw new Error('Could not find "Spreadsheet Import" button on the edit page.');
}
```

**D. Apply same multi-strategy to other brittle selectors:**

- Line 146 (`label:has-text("CSV Upload")`) — add fallback: `input[value*="csv"i]`, `:text("CSV")`
- Line 156 (`button:has-text("Create Set")`) — add fallback: `button[type="submit"]`, `:text("Create")`
- Lines 207 (Import confirmation) — already has multiple selectors, but add `button:has-text("Confirm")`
- Lines 248-250 (`Save Set`) — add `button:has-text("Save")`, `[class*="save"i]`

### Fix 2: Non-interactive fallback for Schoology (`post-to-schoology.mjs`)

**Strategy:** Detect when stdin is not a TTY (non-interactive) and skip the prompt instead of blocking.

#### Add `--no-prompt` flag:

```js
// In arg parsing, add:
let noPrompt = false;
// ...
} else if (arg === "--no-prompt") {
  noPrompt = true;
}
```

#### Modify the promptUser fallback (line 532):

```js
if (noPrompt || !process.stdin.isTTY) {
  console.log("  Skipping Blooket URL prompt (non-interactive mode).");
  blooketUrl = null;
} else {
  const blooketInput = await promptUser("Enter Blooket URL (or press Enter to skip): ");
  // ... existing logic
}
```

#### Update lesson-prep.mjs to pass `--no-prompt`:

In `step6_postToSchoology()` (line 1164 area), add `--no-prompt` to the args array:

```js
const args = [`--unit ${unit}`, `--lesson ${lesson}`, `--auto-urls`, `--with-videos`, `--no-prompt`];
```

### Fix 3: Prevent double Blooket upload attempt

**Problem:** When Step 5 fails, Step 6 (Schoology) tries to auto-upload Blooket again. This wastes time and hits the same failure.

**In `post-to-schoology.mjs`**, the auto-upload section (around line 514) should check the registry first:

```js
// Before attempting auto-upload, check if blooketUpload already failed this run
const regEntry = getLesson(opts.unit, opts.lesson);
if (regEntry?.status?.blooketUpload === "failed") {
  console.log("  Blooket upload already failed this run, skipping re-attempt.");
  autoUrl = null;
} else {
  // existing auto-upload logic
}
```

## Files Modified

| File | Changes |
|------|---------|
| `scripts/upload-blooket.mjs` | Multi-strategy selector search, DOM debug dump on failure |
| `scripts/post-to-schoology.mjs` | `--no-prompt` flag, `isTTY` check, skip re-upload if registry shows failed |
| `scripts/lesson-prep.mjs` | Pass `--no-prompt` to post-to-schoology invocation |

## No New Files

All changes are edits to existing scripts.

## Verification

1. Run `node scripts/upload-blooket.mjs --unit 6 --lesson 11 --force` with Edge debug open to Blooket
   - If the button is found with a new selector → success
   - If still not found → the debug dump prints the actual page state for manual inspection
2. Run `node scripts/post-to-schoology.mjs --unit 6 --lesson 11 --no-prompt` without a Blooket URL
   - Should skip the prompt and continue without blocking
3. Full pipeline: `node scripts/lesson-prep.mjs --unit 6 --lesson 11 --skip-ingest --force`
   - Step 5 failure should NOT cause Step 6 to re-attempt Blooket
   - Step 6 should NOT block on stdin
   - Pipeline should complete with Blooket marked as manual task

## Note on Blooket UI Investigation

The selector fix is speculative — we don't know exactly what the current Blooket DOM looks like. The debug dump is the most important part of this fix: even if the multi-strategy selectors still fail, the dump will print the actual buttons on the page, enabling a targeted one-line fix. The alternative is to run `watch-blooket.mjs` or manually inspect the Blooket edit page in DevTools to find the current button selector.
