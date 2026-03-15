#!/usr/bin/env node
/**
 * probe-delete-dom.mjs — Diagnostic probe for Schoology link deletion.
 *
 * Navigates to a Schoology folder containing a known link, inspects the DOM
 * structure of the link row, gear button, and dropdown menu. Reports exactly
 * what selectors match and why deleteSchoologyLink() might be failing.
 *
 * Usage:
 *   node scripts/probe-delete-dom.mjs
 *   node scripts/probe-delete-dom.mjs --link-id 8288285111
 */

import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";

// ── Target links to probe ───────────────────────────────────────────────────

const TARGETS = [
  { lesson: "6.4",  period: "E", linkId: "8288285111", folderId: "986896666", courseId: "7945275798" },
  { lesson: "6.5",  period: "E", linkId: "8288285243", folderId: "986896718", courseId: "7945275798" },
  { lesson: "6.11", period: "B", linkId: "8286302261", folderId: "986588515", courseId: "7945275782" },
  { lesson: "6.11", period: "E", linkId: "8288287536", folderId: "986897040", courseId: "7945275798" },
];

const args = process.argv.slice(2);
const specificId = args.includes("--link-id") ? args[args.indexOf("--link-id") + 1] : null;

const targets = specificId
  ? TARGETS.filter(t => t.linkId === specificId)
  : [TARGETS[0]]; // probe just the first one by default

async function probeLink(page, target) {
  const folderUrl = `https://lynnschools.schoology.com/course/${target.courseId}/materials?f=${target.folderId}`;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Probing: Lesson ${target.lesson} Period ${target.period} — Link ${target.linkId}`);
  console.log(`URL: ${folderUrl}`);
  console.log("=".repeat(70));

  // Navigate to the folder
  await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);

  // ── Step 1: Find the link anchor ────────────────────────────────────────

  const step1 = await page.evaluate((id) => {
    const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
    if (!anchor) {
      // Dump all link anchors on the page for comparison
      const allLinks = [...document.querySelectorAll('a[href*="/link/view/"]')];
      return {
        found: false,
        allLinkIds: allLinks.map(a => {
          const m = a.href.match(/\/link\/view\/(\d+)/);
          return { id: m?.[1], text: a.textContent.trim().slice(0, 60), href: a.href };
        }),
        pageTitle: document.title,
        bodyText: document.body?.innerText?.slice(0, 500),
      };
    }

    return {
      found: true,
      text: anchor.textContent.trim(),
      href: anchor.href,
      parentTag: anchor.parentElement?.tagName,
      grandparentTag: anchor.parentElement?.parentElement?.tagName,
    };
  }, target.linkId);

  console.log("\n--- Step 1: Find link anchor ---");
  console.log(JSON.stringify(step1, null, 2));

  if (!step1.found) {
    console.log("STOP: Link not found on page. Cannot continue probe.");
    return;
  }

  // ── Step 2: Inspect the row container ───────────────────────────────────

  const step2 = await page.evaluate((id) => {
    const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
    const tr = anchor.closest("tr");
    const li = anchor.closest("li");
    const div = anchor.closest("[class*='material']") || anchor.closest("[class*='item']");
    const row = tr || li || div;

    if (!row) {
      // Walk up the tree and report all ancestors
      const ancestors = [];
      let el = anchor.parentElement;
      for (let i = 0; i < 10 && el; i++) {
        ancestors.push({
          tag: el.tagName,
          id: el.id || null,
          classes: el.className || null,
        });
        el = el.parentElement;
      }
      return { rowFound: false, ancestors };
    }

    return {
      rowFound: true,
      rowTag: row.tagName,
      rowId: row.id || null,
      rowClasses: row.className || null,
      rowInnerHTML: row.innerHTML.slice(0, 2000),
    };
  }, target.linkId);

  console.log("\n--- Step 2: Row container ---");
  console.log(JSON.stringify(step2, null, 2));

  // ── Step 3: Find gear/options button ────────────────────────────────────

  const step3 = await page.evaluate((id) => {
    const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
    const row = anchor.closest("tr") || anchor.closest("li") ||
                anchor.closest("[class*='material']") || anchor.closest("[class*='item']") ||
                anchor.parentElement?.parentElement?.parentElement;

    if (!row) return { gearFound: false, reason: "no row" };

    // Try multiple selectors for the gear/options button
    const selectors = [
      "div.action-links-unfold",
      "a.action-links-unfold",
      ".action-links-unfold",
      "[class*='action-links']",
      "[class*='gear']",
      "[class*='options']",
      "[class*='kebab']",
      "[class*='more']",
      "[class*='dropdown']",
      "button[class*='action']",
      ".sExtlink-processed .action-links-unfold",
      ".action-links .action-links-unfold",
    ];

    const results = {};
    for (const sel of selectors) {
      const els = row.querySelectorAll(sel);
      if (els.length > 0) {
        results[sel] = els.length + " found: " + [...els].map(e =>
          `<${e.tagName} class="${e.className}" id="${e.id||''}">`
        ).join(", ");
      }
    }

    // Also dump all clickable elements in the row
    const clickables = [...row.querySelectorAll("a, button, [onclick], [role='button']")];
    const clickableInfo = clickables.map(e => ({
      tag: e.tagName,
      classes: e.className?.slice(0, 80) || "",
      text: e.textContent.trim().slice(0, 40),
      href: e.href || null,
    }));

    return {
      gearFound: Object.keys(results).length > 0,
      selectorResults: results,
      allClickables: clickableInfo,
    };
  }, target.linkId);

  console.log("\n--- Step 3: Gear/options button ---");
  console.log(JSON.stringify(step3, null, 2));

  // ── Step 4: Try clicking the gear and inspect dropdown ──────────────────

  if (step3.gearFound) {
    const step4 = await page.evaluate((id) => {
      const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
      const row = anchor.closest("tr") || anchor.closest("li") ||
                  anchor.closest("[class*='material']") || anchor.closest("[class*='item']") ||
                  anchor.parentElement?.parentElement?.parentElement;

      const gear = row.querySelector(".action-links-unfold") ||
                   row.querySelector("[class*='action-links']");
      if (!gear) return { clicked: false, reason: "gear not found for click" };

      gear.click();
      return { clicked: true, gearTag: gear.tagName, gearClass: gear.className };
    }, target.linkId);

    console.log("\n--- Step 4a: Gear click ---");
    console.log(JSON.stringify(step4, null, 2));

    // Wait for dropdown
    await page.waitForTimeout(1500);

    // Inspect what appeared
    const step4b = await page.evaluate((id) => {
      const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
      const row = anchor?.closest("tr") || anchor?.closest("li") ||
                  anchor?.closest("[class*='material']") || anchor?.closest("[class*='item']") ||
                  anchor?.parentElement?.parentElement?.parentElement;

      // Check for dropdown within row
      const rowDropdowns = row ? [...row.querySelectorAll("[class*='action-links-content'], [class*='dropdown'], [class*='menu'], ul, [role='menu']")] : [];
      const rowDropdownInfo = rowDropdowns.map(d => ({
        tag: d.tagName,
        classes: d.className?.slice(0, 100),
        visible: d.offsetParent !== null || d.style.display !== "none",
        children: [...d.children].map(c => ({
          tag: c.tagName,
          text: c.textContent.trim().slice(0, 50),
          classes: c.className?.slice(0, 60),
        })),
      }));

      // Check for any visible dropdowns anywhere on page
      const allVisible = [...document.querySelectorAll("ul.action-links-content, [class*='popup'], [class*='dropdown-menu'], [role='menu']")]
        .filter(d => d.offsetParent !== null)
        .map(d => ({
          tag: d.tagName,
          classes: d.className?.slice(0, 100),
          innerHTML: d.innerHTML.slice(0, 1000),
        }));

      return { rowDropdowns: rowDropdownInfo, visibleGlobal: allVisible };
    }, target.linkId);

    console.log("\n--- Step 4b: Dropdown inspection ---");
    console.log(JSON.stringify(step4b, null, 2));

    // Escape to close
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ── Step 5: Try Schoology API approach ──────────────────────────────────

  console.log("\n--- Step 5: Alternative — Schoology API check ---");
  const apiCheck = await page.evaluate(() => {
    // Check if Schoology API client is available
    return {
      hasJQuery: typeof window.jQuery !== "undefined",
      hasSclass: typeof window.sclass !== "undefined",
      hasSchoology: typeof window.Schoology !== "undefined",
      hasSS: typeof window.SS !== "undefined",
      csrfToken: document.querySelector('meta[name="csrf-token"]')?.content?.slice(0, 10) + "..." || null,
      hasFetchInterceptor: typeof window.__schoology_fetch !== "undefined",
    };
  });
  console.log(JSON.stringify(apiCheck, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology" });
  console.log("Connected to browser.");

  for (const target of targets) {
    await probeLink(page, target);
  }

  console.log("\n" + "=".repeat(70));
  console.log("Probe complete.");
}

main().catch(err => {
  console.error("Probe failed:", err.message);
  process.exit(1);
});
