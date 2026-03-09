# Agent: heal-utilities

## Task

Add two new exported functions to `scripts/lib/schoology-heal.mjs`: `deleteSchoologyLink()` and `findOrphanedLinks()`. These enable `--heal` to detect and remove lesson links that got dumped at the course root instead of inside their day folder.

## File to modify

`scripts/lib/schoology-heal.mjs` (190 lines)

## Critical Implementation Detail

Schoology's options gear is a `<div class="action-links-unfold" role="button">`, NOT a `<button>`. Playwright's `.click()` method hangs on it (30s timeout). You MUST use `page.evaluate(() => element.click())` — a JS-dispatched click — for all interactions with Schoology dropdown menus. This was discovered empirically and is the single most important thing in this file.

## Existing file structure

```
import { computeUrls, getLesson } from "./lesson-registry.mjs";

function buildLinkTitles(unit, lesson) { ... }           // private, line 10
export function buildExpectedLinks(unit, lesson, opts) { ... }  // line 19
export async function auditSchoologyFolder(page, folderUrl, expectedLinks) { ... }  // line 54
export async function discoverLessonFolder(page, unit, lesson, materialsRootUrl) { ... }  // line 117
export async function verifyPostedLink(page, title, folderUrl) { ... }  // line 163
```

## Functions to add

Add both functions AFTER `discoverLessonFolder` and BEFORE `verifyPostedLink` (i.e., insert at line 162, before the `export async function verifyPostedLink` line).

### 1. `deleteSchoologyLink(page, linkViewId)`

Deletes a single Schoology material link by its view ID. Returns `{ deleted: true }` or `{ deleted: false, reason: string }`.

```js
/**
 * Delete a single Schoology link by its view ID.
 * Uses JS-dispatched clicks because Playwright's .click() hangs on
 * Schoology's div.action-links-unfold gear buttons.
 */
export async function deleteSchoologyLink(page, linkViewId) {
  // Step 1: Find the link's row and click its gear icon via JS
  const gearClicked = await page.evaluate((id) => {
    const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
    if (!anchor) return { ok: false, reason: "link not found on page" };
    const tr = anchor.closest("tr");
    if (!tr) return { ok: false, reason: "no parent row" };
    const gear = tr.querySelector("div.action-links-unfold");
    if (!gear) return { ok: false, reason: "no gear button in row" };
    gear.click();
    return { ok: true };
  }, linkViewId);

  if (!gearClicked.ok) {
    return { deleted: false, reason: gearClicked.reason };
  }

  await page.waitForTimeout(1000);

  // Step 2: Click "Delete" in the dropdown
  const deleteClicked = await page.evaluate(() => {
    for (const a of document.querySelectorAll("ul.action-links-content a, .action-links-content a")) {
      if (a.textContent.trim().toLowerCase() === "delete") {
        a.click();
        return true;
      }
    }
    return false;
  });

  if (!deleteClicked) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    return { deleted: false, reason: "no Delete option in dropdown" };
  }

  await page.waitForTimeout(1500);

  // Step 3: Confirm the deletion dialog
  const confirmed = await page.evaluate(() => {
    for (const el of document.querySelectorAll('input[value="Delete"], button')) {
      const text = (el.value || el.textContent || "").trim().toLowerCase();
      if (text === "delete") {
        el.click();
        return true;
      }
    }
    return false;
  });

  if (!confirmed) {
    return { deleted: false, reason: "no confirm button found" };
  }

  await page.waitForTimeout(2000);
  return { deleted: true };
}
```

### 2. `findOrphanedLinks(page, unit, lesson, materialsRootUrl)`

Scans the course root for links whose titles match a lesson's expected patterns. These are "orphans" — links that belong inside a folder but got dumped at the root.

```js
/**
 * Scan the course materials root for orphaned links matching a lesson's
 * title patterns (e.g. "Topic 6.10 — Drills"). Returns an array of
 * { linkViewId, title } objects for links at the root level.
 */
export async function findOrphanedLinks(page, unit, lesson, materialsRootUrl) {
  await page.goto(materialsRootUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const titles = buildLinkTitles(unit, lesson);
  // Build patterns to match: exact titles + loose "Topic X.Y" prefix for videos
  const exactTitles = Object.values(titles).map((t) => t.toLowerCase());
  const topicPrefix = `Topic ${unit}.${lesson}`.toLowerCase();

  const orphans = await page.evaluate(
    ({ exactTitles, topicPrefix }) => {
      const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
      const results = [];

      // Only scan root-level link rows (tr[id^="s-"]), not folder contents
      for (const row of document.querySelectorAll('tr[id^="s-"]')) {
        const anchor = row.querySelector('a[href*="/link/view/"]');
        if (!anchor) continue;

        const title = clean(anchor.textContent || anchor.getAttribute("title") || "");
        if (!title) continue;

        const titleLower = title.toLowerCase();
        const isMatch =
          exactTitles.includes(titleLower) ||
          titleLower.startsWith(topicPrefix + " —") ||
          titleLower.startsWith(topicPrefix + " —");

        if (!isMatch) continue;

        // Extract link view ID from href
        const hrefMatch = (anchor.getAttribute("href") || "").match(/\/link\/view\/(\d+)/);
        if (!hrefMatch) continue;

        results.push({ linkViewId: hrefMatch[1], title });
      }

      return results;
    },
    { exactTitles, topicPrefix }
  );

  return orphans;
}
```

Note: The `isMatch` check includes both em-dash (—) and regular dash variants for robustness. The `topicPrefix` check catches video links like "Topic 6.10 — AP Classroom Video 1" that aren't in the exact titles list.

## Constraints

- Only modify `scripts/lib/schoology-heal.mjs`
- Do NOT modify any other files
- Insert both functions BEFORE `verifyPostedLink` (keep that function last)
- Both must be named exports
- `buildLinkTitles()` is already a private helper at line 10 — reuse it, do NOT duplicate it
- Use `page.evaluate()` for ALL Schoology element clicks (never Playwright `.click()` on Schoology controls)

## Verification

```bash
node --check scripts/lib/schoology-heal.mjs
node -e "import('./scripts/lib/schoology-heal.mjs').then(m => console.log(typeof m.deleteSchoologyLink, typeof m.findOrphanedLinks))"
```

Expected output:
```
function function
```
