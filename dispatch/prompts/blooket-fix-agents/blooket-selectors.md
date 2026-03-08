# Agent: blooket-selectors

## Task

Edit `scripts/upload-blooket.mjs` to replace all brittle single-selector Playwright lookups with a multi-strategy cascade, and add a DOM debug dump when the "Spreadsheet Import" button can't be found.

## File to modify

`scripts/upload-blooket.mjs` (414 lines)

## Current problem

Every interactive element is located with a single Playwright selector like:
```js
await page.$('div:has-text("Spreadsheet Import")')
```
When Blooket changes their UI (tag names, text, class names), the selector fails silently and the script throws. There is no diagnostic output to help debug what the page actually looks like.

## Changes

### 1. Add `findButton()` helper (insert before the `uploadBlooket` function, around line 133)

```js
async function findButton(page, strategies, label) {
  for (const { selector, description } of strategies) {
    try {
      const el = await page.$(selector);
      if (el) {
        console.log(`  Found "${label}" via: ${description}`);
        return el;
      }
    } catch {
      // selector syntax not supported in this browser, skip
    }
  }
  return null;
}
```

### 2. Add `dumpPageState()` debug helper (insert right after `findButton`)

```js
async function dumpPageState(page) {
  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    visibleText: document.body.innerText.substring(0, 600),
    buttons: [...document.querySelectorAll('button, [role="button"], div[class*="button" i], a[class*="button" i]')]
      .slice(0, 20)
      .map(el => ({
        tag: el.tagName,
        text: (el.innerText || "").trim().substring(0, 80),
        classes: (el.className || "").substring(0, 100),
      })),
  }));
  console.error("\n  DEBUG — page state at failure:");
  console.error("  URL:", info.url);
  console.error("  Title:", info.title);
  console.error("  Visible text (first 600 chars):\n   ", info.visibleText.replace(/\n/g, "\n    "));
  console.error("  Clickable elements:", JSON.stringify(info.buttons, null, 2));
}
```

### 3. Replace "CSV Upload" radio selector (line 146)

**Before:**
```js
await page.click('label:has-text("CSV Upload")');
```

**After:**
```js
const csvRadio = await findButton(page, [
  { selector: 'label:has-text("CSV Upload")', description: "label text" },
  { selector: 'label:has-text("CSV")', description: "label CSV" },
  { selector: 'input[value*="csv" i]', description: "input value csv" },
  { selector: '[class*="csv" i]', description: "class contains csv" },
], "CSV Upload");
if (!csvRadio) {
  await dumpPageState(page);
  throw new Error('Could not find "CSV Upload" option on the create page.');
}
await csvRadio.click();
```

### 4. Replace "Create Set" button selector (line 156)

**Before:**
```js
await page.click('button:has-text("Create Set")');
```

**After:**
```js
const createBtn = await findButton(page, [
  { selector: 'button:has-text("Create Set")', description: "button text" },
  { selector: 'button[type="submit"]', description: "submit button" },
  { selector: 'div:has-text("Create Set")', description: "div text" },
  { selector: 'button:has-text("Create")', description: "button Create" },
], "Create Set");
if (!createBtn) {
  await dumpPageState(page);
  throw new Error('Could not find "Create Set" button.');
}
await createBtn.click();
```

### 5. Replace "Spreadsheet Import" button selector (lines 183-189)

**Before:**
```js
console.log('  Clicking "Spreadsheet Import"...');
const importBtn = await page.$('div:has-text("Spreadsheet Import")');
if (!importBtn) {
  throw new Error('Could not find "Spreadsheet Import" button on the edit page.');
}
await importBtn.click();
```

**After:**
```js
console.log('  Clicking "Spreadsheet Import"...');
const importBtn = await findButton(page, [
  { selector: 'button:has-text("Spreadsheet Import")', description: "button text" },
  { selector: 'div[class*="import" i]:has-text("Spreadsheet")', description: "div class+text" },
  { selector: '[class*="import" i]', description: "class contains import" },
  { selector: 'button:has-text("Import")', description: "button Import" },
  { selector: 'div:has-text("Spreadsheet Import")', description: "div text (original)" },
  { selector: ':has-text("Spreadsheet Import")', description: "any element text" },
], "Spreadsheet Import");
if (!importBtn) {
  await dumpPageState(page);
  throw new Error('Could not find "Spreadsheet Import" button on the edit page.');
}
await importBtn.click();
```

### 6. Replace Import/Upload confirmation selector (line 207)

**Before:**
```js
const confirmBtn = await page.$('div:has-text("Import"), button:has-text("Import"), div:has-text("Upload"), button:has-text("Upload")');
```

**After:**
```js
const confirmBtn = await findButton(page, [
  { selector: 'button:has-text("Import")', description: "button Import" },
  { selector: 'div:has-text("Import")', description: "div Import" },
  { selector: 'button:has-text("Upload")', description: "button Upload" },
  { selector: 'button:has-text("Confirm")', description: "button Confirm" },
  { selector: 'div:has-text("Upload")', description: "div Upload" },
], "Import/Upload confirmation");
```
Note: If `confirmBtn` is null here, keep the existing behavior — just log a warning and continue (don't throw). The original code already handles this case.

### 7. Replace "Save Set" button selector (lines 248-250)

**Before:**
```js
const saveBtn =
  (await page.$('div[class*="saveButton"]:has-text("Save Set")')) ||
  (await page.$('div:has-text("Save Set")'));
```

**After:**
```js
const saveBtn = await findButton(page, [
  { selector: 'div[class*="saveButton"]:has-text("Save Set")', description: "div saveButton class" },
  { selector: 'button:has-text("Save Set")', description: "button text" },
  { selector: 'button:has-text("Save")', description: "button Save" },
  { selector: '[class*="save" i]:has-text("Save")', description: "class+text save" },
  { selector: 'div:has-text("Save Set")', description: "div text (original)" },
], "Save Set");
```
Keep the existing error throw if `saveBtn` is null, but add `await dumpPageState(page)` before the throw.

## Constraints

- Only modify `scripts/upload-blooket.mjs`
- Do NOT modify any other files
- Do NOT change the overall flow (create → redirect → import CSV → save)
- Do NOT change arg parsing, registry updates, or clipboard logic
- Preserve all existing `console.log` messages
- Keep `waitForTimeout` delays as-is
- Valid ESM syntax
