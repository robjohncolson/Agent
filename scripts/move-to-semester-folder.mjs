#!/usr/bin/env node
/**
 * move-to-semester-folder.mjs — Move lesson folders into a semester folder on Schoology.
 *
 * Usage:
 *   node scripts/move-to-semester-folder.mjs --period E --into S1 --from 1.1 --to 4.8 [--dry-run]
 */

import { connectCDP } from "./lib/cdp-connect.mjs";
import {
  navigateToFolder,
  listItems,
  findFolderByName,
  openGearMenu,
  clickMoveOption,
  waitForPopup,
  selectMoveTarget,
  getMoveOptions,
  submitMovePopup,
  clickAddMaterials,
  clickAddFolder,
  sleep,
  COURSE_IDS,
} from "./lib/schoology-dom.mjs";

// ── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let period = "E";
let targetFolder = "S1";
let fromKey = "1.1";
let toKey = "4.8";
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--period") period = args[++i];
  if (args[i] === "--into") targetFolder = args[++i];
  if (args[i] === "--from") fromKey = args[++i];
  if (args[i] === "--to") toKey = args[++i];
  if (args[i] === "--dry-run") dryRun = true;
}

const courseId = COURSE_IDS[period];
if (!courseId) {
  console.error(`Unknown period: ${period}`);
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseKey(key) {
  const [u, l] = key.split(".").map(Number);
  return { unit: u, lesson: l };
}

function inRange(folderName) {
  const match = folderName.match(/^Topic\s+(\d+)\.(\d+)/);
  if (!match) return false;
  const unit = parseInt(match[1], 10);
  const lesson = parseInt(match[2], 10);
  const from = parseKey(fromKey);
  const to = parseKey(toKey);

  if (unit < from.unit || unit > to.unit) return false;
  if (unit === from.unit && lesson < from.lesson) return false;
  if (unit === to.unit && lesson > to.lesson) return false;
  return true;
}

function sortKey(name) {
  const match = name.match(/^Topic\s+(\d+)\.(\d+)/);
  if (!match) return 999999;
  return parseInt(match[1], 10) * 100 + parseInt(match[2], 10);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Moving Topic folders ${fromKey}–${toKey} into "${targetFolder}" (Period ${period})`);
  console.log(`Course ID: ${courseId}`);
  if (dryRun) console.log("[DRY RUN]\n");

  const { chromium } = await import("playwright");
  const { browser, page } = await connectCDP(chromium, {
    preferUrl: `schoology.com/course/${courseId}`,
  });

  try {
    // Navigate to course materials root
    await navigateToFolder(page, courseId);
    await sleep(2000);

    // List all items at root
    let items = await listItems(page);
    const folders = items.filter(i => i.type === "folder");

    console.log(`Found ${folders.length} folders at root.\n`);

    // Check if target folder exists, create if not
    let target = folders.find(f => f.name === targetFolder);
    if (!target) {
      console.log(`Creating "${targetFolder}" folder...`);
      if (!dryRun) {
        await clickAddMaterials(page);
        await sleep(1000);
        await clickAddFolder(page);
        await sleep(1000);

        // Fill folder title
        await page.fill('#edit-folder-title, input[name="title"]', targetFolder);
        await sleep(500);

        // Click Create
        await page.click('.submit-button, #edit-submit, button:has-text("Create")');
        await sleep(2000);

        console.log(`  "${targetFolder}" created.\n`);

        // Re-list to get updated items
        await navigateToFolder(page, courseId);
        await sleep(2000);
        items = await listItems(page);
      } else {
        console.log(`  [dry-run] Would create "${targetFolder}"\n`);
      }
    } else {
      console.log(`"${targetFolder}" already exists (ID: ${target.id}).\n`);
    }

    // Find all Topic folders in range
    const toMove = folders
      .filter(f => inRange(f.name))
      .sort((a, b) => sortKey(a.name) - sortKey(b.name));

    console.log(`${toMove.length} folders to move:\n`);
    for (const f of toMove) {
      console.log(`  ${f.name} (ID: ${f.id})`);
    }
    console.log();

    if (dryRun) {
      console.log("[dry-run] No moves performed.");
      return;
    }

    // Move each folder
    let moved = 0;
    let failed = 0;

    for (let i = 0; i < toMove.length; i++) {
      const folder = toMove[i];
      console.log(`[${i + 1}/${toMove.length}] Moving "${folder.name}"...`);

      try {
        // Navigate back to root each time (folder list changes after moves)
        await navigateToFolder(page, courseId);
        await sleep(2000);

        const rowId = `f-${folder.id}`;

        // Open gear menu
        await openGearMenu(page, rowId);
        await sleep(1000);

        // Click Move
        await clickMoveOption(page, rowId);

        // Wait for popup
        const popupLoaded = await waitForPopup(page);
        if (!popupLoaded) {
          console.error("  Move popup did not appear");
          failed++;
          continue;
        }
        await sleep(1500);

        // Select target
        const selected = await selectMoveTarget(page, targetFolder);
        if (!selected.found) {
          console.error(`  Could not find "${targetFolder}" in move dropdown`);
          const options = await getMoveOptions(page);
          console.error("  Available:", options.map(o => o.text).join(", "));
          failed++;
          continue;
        }

        // Submit
        await submitMovePopup(page);
        await sleep(2000);

        console.log(`  Moved "${folder.name}" into "${targetFolder}".`);
        moved++;
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        failed++;
      }
    }

    console.log(`\nDone. Moved: ${moved}, Failed: ${failed}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
