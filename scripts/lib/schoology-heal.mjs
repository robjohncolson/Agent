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
