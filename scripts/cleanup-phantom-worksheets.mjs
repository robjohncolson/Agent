#!/usr/bin/env node
/**
 * cleanup-phantom-worksheets.mjs — Remove worksheet links from Schoology
 * for lessons where the actual HTML file doesn't exist yet.
 *
 * Usage:
 *   node scripts/cleanup-phantom-worksheets.mjs --dry-run
 *   node scripts/cleanup-phantom-worksheets.mjs [--period E] [--period B]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { connectCDP } from "./lib/cdp-connect.mjs";
import { AGENT_ROOT, WORKSHEET_REPO } from "./lib/paths.mjs";
import { COURSE_IDS, navigateToFolder, listItems, sleep } from "./lib/schoology-dom.mjs";

const REGISTRY_PATH = join(AGENT_ROOT, "state", "lesson-registry.json");

// ── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let dryRun = false;
const periods = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dry-run") dryRun = true;
  if (args[i] === "--period") periods.push(args[++i]);
}
if (periods.length === 0) periods.push("E", "B");

// ── Find phantom worksheets ────────────────────────────────────────────────

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

const phantoms = []; // { key, period, folderUrl, title }

for (const [key, entry] of Object.entries(registry)) {
  const wsUrl = entry.urls?.worksheet;
  if (!wsUrl) continue;

  // Check if the actual file exists
  const match = wsUrl.match(/\/([^/]+)$/);
  if (!match) continue;
  const filePath = join(WORKSHEET_REPO, match[1]);
  if (existsSync(filePath)) continue; // real file — skip

  for (const period of periods) {
    const ws = entry.schoology?.[period]?.materials?.worksheet;
    if (!ws) continue;

    const folderUrl = period === "B"
      ? entry.urls?.schoologyFolder
      : entry.urls?.schoologyFolderE;
    if (!folderUrl) continue;

    phantoms.push({
      key,
      period,
      folderUrl,
      title: ws.title || `Topic ${key} — Follow-Along Worksheet`,
      schoologyId: ws.schoologyId || null,
    });
  }
}

// Sort
phantoms.sort((a, b) => {
  const [au, al] = a.key.split(".").map(Number);
  const [bu, bl] = b.key.split(".").map(Number);
  if (a.period !== b.period) return a.period < b.period ? -1 : 1;
  return au - bu || al - bl;
});

console.log(`Found ${phantoms.length} phantom worksheet links to remove:\n`);
for (const p of phantoms) {
  console.log(`  ${p.key} (Period ${p.period}) — "${p.title}"`);
}

if (dryRun || phantoms.length === 0) {
  if (dryRun) console.log("\n[dry-run] No deletions performed.");
  process.exit(0);
}

// ── Delete links ───────────────────────────────────────────────────────────

const { chromium } = await import("playwright");

let deleted = 0;
let failed = 0;

for (const period of periods) {
  const batch = phantoms.filter(p => p.period === period);
  if (batch.length === 0) continue;

  const courseId = COURSE_IDS[period];
  console.log(`\n--- Period ${period} (course ${courseId}) — ${batch.length} links ---\n`);

  const { browser, page } = await connectCDP(chromium, {
    preferUrl: `schoology.com/course/${courseId}`,
  });

  try {
    for (let i = 0; i < batch.length; i++) {
      const p = batch[i];
      console.log(`[${i + 1}/${batch.length}] Deleting worksheet from ${p.key}...`);

      try {
        // Navigate to the lesson folder
        await page.goto(p.folderUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await sleep(2000);

        // Find the worksheet link by title text
        const deleteResult = await page.evaluate((title) => {
          // Find all link rows
          const rows = document.querySelectorAll("tr.type-link, tr[id^='s-l-']");
          for (const row of rows) {
            const linkText = row.querySelector(".item-title a, .materials-link a");
            if (!linkText) continue;
            const text = linkText.textContent.trim();
            if (text === title || text.includes("Follow-Along Worksheet") || text.includes("followalong")) {
              // Found it — click gear menu
              const gear = row.querySelector("div.action-links-unfold, .action-links-unfold");
              if (!gear) return { found: true, reason: "no gear button" };
              gear.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
              gear.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
              gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              return { found: true, gearClicked: true, rowId: row.id };
            }
          }
          return { found: false };
        }, p.title);

        if (!deleteResult.found) {
          console.log("  Worksheet link not found on page — may already be deleted.");
          // Clean up registry anyway
          delete registry[p.key].schoology[p.period].materials.worksheet;
          deleted++;
          continue;
        }

        if (!deleteResult.gearClicked) {
          console.error(`  Found but couldn't click gear: ${deleteResult.reason}`);
          failed++;
          continue;
        }

        await sleep(1000);

        // Click Delete in the dropdown
        const deleteClicked = await page.evaluate(() => {
          for (const dd of document.querySelectorAll("ul.action-links, ul.action-links-content")) {
            if (dd.offsetParent === null) continue;
            for (const a of dd.querySelectorAll("a")) {
              if ((a.textContent || "").trim().toLowerCase() === "delete") {
                a.click();
                return true;
              }
            }
          }
          return false;
        });

        if (!deleteClicked) {
          console.error("  No Delete option in dropdown");
          await page.keyboard.press("Escape");
          failed++;
          continue;
        }

        await sleep(2000);

        // Confirm deletion
        const confirmed = await page.evaluate(() => {
          for (const el of document.querySelectorAll(
            'input[value="Delete"], .popups-box input[type="submit"], .popups-buttons input[type="submit"], button'
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
          console.error("  Could not confirm deletion");
          failed++;
          continue;
        }

        await sleep(2000);
        console.log(`  Deleted "${p.title}".`);

        // Remove from registry
        if (registry[p.key]?.schoology?.[p.period]?.materials?.worksheet) {
          delete registry[p.key].schoology[p.period].materials.worksheet;
        }
        deleted++;
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        failed++;
      }
    }
  } finally {
    await browser.close();
  }
}

// Save updated registry
writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf-8");
console.log(`\nRegistry updated.`);
console.log(`Done. Deleted: ${deleted}, Failed: ${failed}`);
