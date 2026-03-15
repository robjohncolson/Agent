#!/usr/bin/env node
/**
 * probe-root-links.mjs — Find where the 4 stale drill links live in Schoology.
 */

import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";

const LINK_IDS = ["8288285111", "8288285243", "8288287536", "8286302261"];

async function scanPage(page, label, url, ids = LINK_IDS) {
  console.log(`\n=== ${label} ===`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);

  return page.evaluate((ids) => {
    const targets = {};
    for (const id of ids) {
      const a = document.querySelector(`a[href*="/link/view/${id}"]`);
      targets[id] = a
        ? { found: true, text: a.textContent.trim().slice(0, 80) }
        : { found: false };
    }
    const all = [...document.querySelectorAll('a[href*="/link/view/"]')].map(a => {
      const m = a.href.match(/\/link\/view\/(\d+)/);
      return { id: m?.[1], text: a.textContent.trim().slice(0, 60) };
    });
    // Also check for folders
    const folders = [...document.querySelectorAll('a[href*="materials?f="], .folder-title, [class*="folder"]')].map(f => ({
      tag: f.tagName,
      text: f.textContent.trim().slice(0, 60),
      href: f.href || null,
      classes: f.className?.slice(0, 80),
    }));
    return { targets, allLinks: all, folders: folders.slice(0, 20) };
  }, ids);
}

async function main() {
  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology" });

  // Scan Period E root
  let r = await scanPage(page, "Period E — Root", "https://lynnschools.schoology.com/course/7945275798/materials");
  console.log(JSON.stringify(r, null, 2));

  // Scan Period B root
  r = await scanPage(page, "Period B — Root", "https://lynnschools.schoology.com/course/7945275782/materials");
  console.log(JSON.stringify(r, null, 2));

  // If not at root, try the work-ahead folder (links might be there)
  // Scan Period E work-ahead
  r = await scanPage(page, "Period E — work-ahead", "https://lynnschools.schoology.com/course/7945275798/materials?f=986896440");
  console.log(JSON.stringify(r, null, 2));

  // Try specific lesson folders
  for (const { label, url } of [
    { label: "6.4 E folder", url: "https://lynnschools.schoology.com/course/7945275798/materials?f=986896666" },
    { label: "6.5 E folder", url: "https://lynnschools.schoology.com/course/7945275798/materials?f=986896718" },
    { label: "6.11 B folder", url: "https://lynnschools.schoology.com/course/7945275782/materials?f=986588515" },
    { label: "6.11 E folder", url: "https://lynnschools.schoology.com/course/7945275798/materials?f=986897040" },
  ]) {
    r = await scanPage(page, label, url);
    console.log(JSON.stringify(r, null, 2));
  }

  console.log("\nProbe complete.");
}

main().catch(e => {
  console.error("Probe failed:", e.message);
  process.exit(1);
});
