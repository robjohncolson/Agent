/**
 * schoology-heal.mjs -- Schoology folder auditing and link verification.
 *
 * Used by post-to-schoology.mjs --heal to detect missing/failed links
 * and selectively re-post only what's needed.
 */

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
    links.push({
      key: "worksheet",
      title: titles.worksheet,
      url: urls.worksheet,
    });
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

export async function auditSchoologyFolder(page, folderUrl, expectedLinks) {
  await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Collect links from the folder DOM (same selectors as scrape-schoology-urls.mjs collectFolderLinks)
  const existing = await page.evaluate(() => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const output = [];
    const seen = new Set();

    const rows = document.querySelectorAll('tr[id^="s-"], tr.material-row, .material-row');

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
    const found = existing.find((e) => e.title.toLowerCase().trim() === normalExpected);

    if (found) {
      matched.push({ ...expected, existingUrl: found.url });
    } else {
      missing.push(expected);
    }
  }

  return { existing, missing, matched };
}

/**
 * Discover which Schoology folder contains a lesson's links by scanning
 * folder contents for "Topic {unit}.{lesson}" title patterns.
 * Returns { folderUrl, folderTitle } or null if no folder matches.
 */
export async function discoverLessonFolder(page, unit, lesson, materialsRootUrl) {
  await page.goto(materialsRootUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Collect all folders from the materials root (same selectors as post-to-schoology.mjs extractFolderUrl)
  const folders = await page.$$('tr[id^="f-"]');
  const topicPattern = `Topic ${unit}.${lesson}`;

  for (const row of folders) {
    const titleEl = await row.$("div.folder-title");
    if (!titleEl) continue;
    const folderTitle = (await titleEl.innerText().catch(() => "")).trim();
    if (!folderTitle) continue;

    const rowId = await row.getAttribute("id"); // e.g. "f-986313435"
    const folderId = rowId.replace("f-", "");
    const folderUrl = `${materialsRootUrl}?f=${folderId}`;

    // Navigate into the folder and scan link titles
    await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const hasMatch = await page.evaluate((pattern) => {
      const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
      const rows = document.querySelectorAll('tr[id^="s-"], tr.material-row, .material-row');
      for (const r of rows) {
        for (const a of r.querySelectorAll("a[href]")) {
          const title = clean(a.textContent || a.getAttribute("title") || "");
          if (title.includes(pattern)) return true;
        }
      }
      return false;
    }, topicPattern);

    if (hasMatch) {
      return { folderUrl, folderTitle };
    }

    // Go back to materials root for next folder
    await page.goto(materialsRootUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  return null;
}

/**
 * Delete a single Schoology link by its view ID.
 * Uses JS-dispatched clicks because Playwright's .click() hangs on
 * Schoology's div.action-links-unfold gear buttons.
 *
 * Fix: scopes the Delete click to the target row's dropdown (not the
 * whole page) and verifies the link row actually disappeared after
 * confirmation.
 */
export async function deleteSchoologyLink(page, linkViewId) {
  // Step 1: Find the link row and click its gear icon via dispatchEvent
  // (Schoology binds via jQuery delegation — synthetic .click() doesn't always fire)
  const gearClicked = await page.evaluate((id) => {
    const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
    if (!anchor) return { ok: false, reason: "link not found on page" };
    const tr = anchor.closest("tr");
    if (!tr) return { ok: false, reason: "no parent row" };
    const gear = tr.querySelector("div.action-links-unfold") ||
                 tr.querySelector(".action-links-unfold");
    if (!gear) return { ok: false, reason: "no gear button in row" };
    gear.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    gear.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return { ok: true };
  }, linkViewId);

  if (!gearClicked.ok) {
    return { deleted: false, reason: gearClicked.reason };
  }

  await page.waitForTimeout(1000);

  // Step 2: Click "Delete" — the dropdown is <ul class="action-links"> inside the row.
  const deleteClicked = await page.evaluate((id) => {
    const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
    const tr = anchor?.closest("tr");
    if (tr) {
      // Primary: look in ul.action-links (current Schoology DOM)
      for (const a of tr.querySelectorAll(".action-links a, .action-links-content a")) {
        if ((a.textContent || "").trim().toLowerCase() === "delete") {
          a.click();
          return true;
        }
      }
    }
    // Fallback: find any currently-visible dropdown on the page
    for (const dd of document.querySelectorAll("ul.action-links, ul.action-links-content")) {
      if (dd.offsetParent === null) continue; // hidden
      for (const a of dd.querySelectorAll("a")) {
        if ((a.textContent || "").trim().toLowerCase() === "delete") {
          a.click();
          return true;
        }
      }
    }
    return false;
  }, linkViewId);

  if (!deleteClicked) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    return { deleted: false, reason: "no Delete option in dropdown" };
  }

  await page.waitForTimeout(2000);

  // Step 3: Confirm the deletion dialog (Schoology popup form)
  const confirmed = await page.evaluate(() => {
    // Try popup confirm buttons — Schoology uses various patterns
    for (const el of document.querySelectorAll(
      'input[value="Delete"], input[value="delete"], ' +
      '.popups-box input[type="submit"], ' +
      '.popups-buttons input[type="submit"], ' +
      'button'
    )) {
      const text = (el.value || el.textContent || "").trim().toLowerCase();
      if (text === "delete" || text === "confirm") {
        el.click();
        return true;
      }
    }
    return false;
  });

  if (!confirmed) {
    return { deleted: false, reason: "no confirm button found" };
  }

  await page.waitForTimeout(3000);

  // Step 4: Verify the link row is actually gone
  const stillPresent = await page.evaluate((id) => {
    return !!document.querySelector(`a[href*="/link/view/${id}"]`);
  }, linkViewId);

  if (stillPresent) {
    return { deleted: false, reason: "link still present after delete confirmation" };
  }

  return { deleted: true };
}

/**
 * Scan the course materials root for orphaned links matching a lesson's
 * title patterns (for example "Topic 6.10 - Drills").
 * Returns an array of { linkViewId, title } objects for links at the root level.
 */
export async function findOrphanedLinks(page, unit, lesson, materialsRootUrl) {
  await page.goto(materialsRootUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const titles = buildLinkTitles(unit, lesson);
  const exactTitles = Object.values(titles).map((t) => t.toLowerCase());
  const topicPrefix = `Topic ${unit}.${lesson}`.toLowerCase();

  const orphans = await page.evaluate(
    ({ exactTitlesInner, topicPrefixInner }) => {
      const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
      const matchesTopicVariant = (value, prefix) => {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`^${escaped}\\s+[\\u2014-]`).test(value);
      };
      const results = [];

      // Only scan root-level link rows (tr[id^="s-"]), not folder contents
      for (const row of document.querySelectorAll('tr[id^="s-"]')) {
        const anchor = row.querySelector('a[href*="/link/view/"]');
        if (!anchor) continue;

        const title = clean(anchor.textContent || anchor.getAttribute("title") || "");
        if (!title) continue;

        const titleLower = title.toLowerCase();
        const isMatch =
          exactTitlesInner.includes(titleLower) || matchesTopicVariant(titleLower, topicPrefixInner);

        if (!isMatch) continue;

        // Extract link view ID from href
        const hrefMatch = (anchor.getAttribute("href") || "").match(/\/link\/view\/(\d+)/);
        if (!hrefMatch) continue;

        results.push({ linkViewId: hrefMatch[1], title });
      }

      return results;
    },
    { exactTitlesInner: exactTitles, topicPrefixInner: topicPrefix }
  );

  return orphans;
}

export async function verifyPostedLink(page, title, folderUrl) {
  await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  const found = await page.evaluate((searchTitle) => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const rows = document.querySelectorAll('tr[id^="s-"], tr.material-row, .material-row');

    for (const row of rows) {
      const anchors = row.querySelectorAll("a[href]");
      for (const anchor of anchors) {
        const currentTitle = clean(
          anchor.textContent ||
            anchor.getAttribute("title") ||
            row.querySelector(".item-title")?.textContent ||
            ""
        );
        if (currentTitle.toLowerCase().trim() === searchTitle.toLowerCase().trim()) {
          return true;
        }
      }
    }
    return false;
  }, title);

  return found;
}
