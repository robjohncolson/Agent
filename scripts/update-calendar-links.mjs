#!/usr/bin/env node
/**
 * update-calendar-links.mjs — One-off: replace the CALENDAR link in both
 * Schoology courses (Period B + E) with the new Supabase-backed calendar URLs.
 *
 * Strategy: delete the old link, then post a new one at the course root.
 */

import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";
import {
  COURSE_IDS,
  navigateToFolder,
  listItems,
  clickAddMaterials,
  clickAddFileLink,
  clickLinkOption,
  fillLinkForm,
  submitPopup,
  sleep,
} from "./lib/schoology-dom.mjs";
import { deleteSchoologyLink } from "./lib/schoology-heal.mjs";

const LINKS = {
  B: {
    courseId: COURSE_IDS.B,
    url: "https://robjohncolson.github.io/apstats-live-worksheet/ap_stats_roadmap_square_mode.html?period=B",
    title: "CALENDAR (now to end of year)",
  },
  E: {
    courseId: COURSE_IDS.E,
    url: "https://robjohncolson.github.io/apstats-live-worksheet/ap_stats_roadmap_square_mode.html?period=E",
    title: "CALENDAR (now to end of year)",
  },
};

async function findCalendarLink(page) {
  // Look for any link whose title contains "CALENDAR" (case-insensitive)
  return page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr');
    for (const r of rows) {
      if (!r.id.startsWith('n-')) continue;
      const a = r.querySelector('a[href*="/link/view/"]');
      if (!a) continue;
      const title = (a.textContent || '').trim();
      if (title.toUpperCase().includes('CALENDAR')) {
        const match = (a.getAttribute('href') || '').match(/\/link\/view\/(\d+)/);
        return {
          viewId: match ? match[1] : null,
          title,
          rowId: r.id,
        };
      }
    }
    return null;
  });
}

async function updatePeriod(page, period) {
  const { courseId, url, title } = LINKS[period];
  console.log(`\n=== Period ${period} (course ${courseId}) ===`);

  // Navigate to course materials root
  await navigateToFolder(page, courseId);

  // Find existing CALENDAR link
  const existing = await findCalendarLink(page);

  if (existing && existing.viewId) {
    console.log(`Found: "${existing.title}" (view ID: ${existing.viewId})`);
    console.log("Deleting old link...");
    const result = await deleteSchoologyLink(page, existing.viewId);
    if (result.deleted) {
      console.log("Deleted successfully.");
    } else {
      console.error(`Delete failed: ${result.reason}`);
      console.log("Proceeding to post new link anyway...");
    }
    // Re-navigate after delete
    await navigateToFolder(page, courseId);
  } else {
    console.log("No existing CALENDAR link found — will create fresh.");
  }

  // Post new link
  console.log(`Posting: "${title}" → ${url}`);
  await clickAddMaterials(page);
  await clickAddFileLink(page);
  await clickLinkOption(page);
  await sleep(1500);
  await fillLinkForm(page, { title, url });
  await submitPopup(page);
  console.log(`Period ${period} done.`);
}

async function main() {
  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology" });

  try {
    await updatePeriod(page, "B");
    await updatePeriod(page, "E");
    console.log("\nBoth periods updated. Verify in browser.");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
