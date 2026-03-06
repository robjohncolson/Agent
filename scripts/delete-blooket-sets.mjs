#!/usr/bin/env node
/**
 * delete-blooket-sets.mjs - Delete one or more Blooket sets via Playwright CDP.
 *
 * Usage:
 *   node scripts/delete-blooket-sets.mjs <setId1> [setId2] ...
 *
 * Example:
 *   node scripts/delete-blooket-sets.mjs 69aa4161572efa156e0d998c 69aa42656790eef16f71addb
 *
 * Start Edge with remote debugging first:
 *   scripts/start-edge-debug.cmd
 *
 * Prerequisites:
 *   npm install playwright
 */

import { connectCDP } from "./lib/cdp-connect.mjs";
import { dismissCookieBanner, scrollToLoadAll, confirmModal, findSetContainer } from "./lib/blooket-helpers.mjs";

const MY_SETS_URL = "https://dashboard.blooket.com/my-sets";

let chromium;

function printUsage() {
  console.log(
    "Usage:\n" +
      "  node scripts/delete-blooket-sets.mjs <setId1> [setId2] ...\n\n" +
      "Example:\n" +
      "  node scripts/delete-blooket-sets.mjs 69aa4161572efa156e0d998c 69aa42656790eef16f71addb\n"
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  return args;
}

async function clickTrashIcon(page, container, setId) {
  const trashBox = await container.evaluate((el) => {
    const trash = el.querySelector("i.fa-trash-alt");
    if (!trash) {
      return null;
    }

    const rect = (trash.parentElement || trash).getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  });

  if (!trashBox) {
    console.log(`Trash icon not found or has no bounding box for set ${setId}`);
    return false;
  }

  await page.mouse.click(trashBox.x, trashBox.y);
  return true;
}

async function deleteSet(page, setId) {
  let container = null;

  try {
    await page.goto(MY_SETS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    await dismissCookieBanner(page);
    await scrollToLoadAll(page);

    container = await findSetContainer(page, setId);
    if (!container) {
      console.log(`Set ${setId} not found on page`);
      return false;
    }

    const clicked = await clickTrashIcon(page, container, setId);
    if (!clicked) {
      return false;
    }

    const modalResult = await confirmModal(page, "delete this set");
    if (!modalResult.confirmed) {
      console.log(
        `Could not confirm deletion for set ${setId}. Modal text: ${modalResult.modalText ?? "(no modal text)"}`
      );
      return false;
    }

    console.log(`Deleted set ${setId}`);
    return true;
  } finally {
    if (container) {
      await container.dispose().catch(() => {});
    }
  }
}

async function main() {
  const setIds = parseArgs(process.argv);

  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.error("Error: 'playwright' package not found.");
    console.error("Install it with: npm install playwright");
    process.exit(1);
  }

  console.log("Blooket Set Deleter");
  console.log("===================");
  console.log(`Sets to delete: ${setIds.length}`);

  const { browser, page } = await connectCDP(chromium, { preferUrl: "blooket" });
  let deletedCount = 0;

  try {
    for (const [index, setId] of setIds.entries()) {
      console.log(`\n[${index + 1}/${setIds.length}] ${setId}`);

      try {
        const deleted = await deleteSet(page, setId);
        if (deleted) {
          deletedCount += 1;
        }
      } catch (err) {
        console.error(`Failed to delete set ${setId}: ${err.message}`);
      }
    }
  } finally {
    console.log("\nDisconnecting from browser (CDP). Your browser remains open.");
    await browser.close();
  }

  console.log(`\nFinished. Deleted ${deletedCount} of ${setIds.length} set(s).`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
