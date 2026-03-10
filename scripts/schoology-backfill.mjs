#!/usr/bin/env node
/**
 * schoology-backfill.mjs — Execute a backfill plan against Schoology via CDP.
 *
 * Reads a plan JSON file and the lesson registry, then creates folders and
 * posts links according to the plan. Idempotent: skips folders that already
 * exist and re-navigates after each link post.
 *
 * Usage:
 *   node scripts/schoology-backfill.mjs dispatch/period-e-backfill-plan.json
 *   node scripts/schoology-backfill.mjs dispatch/period-e-backfill-plan.json --dry-run
 */

import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";
import {
  navigateToFolder,
  listItems,
  findFolderByName,
  clickAddMaterials,
  clickAddFolder,
  clickAddFileLink,
  clickLinkOption,
  waitForPopup,
  waitForPopupClose,
  fillFolderForm,
  fillLinkForm,
  submitPopup,
  sleep,
} from "./lib/schoology-dom.mjs";
import { cmdMoveFolder } from "./lib/schoology-commands-move.mjs";

const LINK_TYPES = [
  { key: "worksheet", titleFn: (l) => `Live Worksheet — ${l}` },
  { key: "drills",    titleFn: (l) => `Drills — ${l}` },
  { key: "quiz",      titleFn: (l) => `Quiz — ${l}` },
  { key: "blooket",   titleFn: (l) => `Blooket — ${l}` },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Navigate into a nested folder path from top level.
 * Returns the final folder's numeric ID, or null if any segment not found.
 */
async function navigatePath(page, courseId, pathSegments) {
  await navigateToFolder(page, courseId);

  let currentFolderId = null;
  for (const segment of pathSegments) {
    if (currentFolderId) {
      await navigateToFolder(page, courseId, currentFolderId);
    }
    const folder = await findFolderByName(page, segment);
    if (!folder) {
      console.error(`    Path segment "${segment}" not found at current level`);
      return null;
    }
    currentFolderId = folder.id;
    await navigateToFolder(page, courseId, currentFolderId);
  }
  return currentFolderId;
}

/**
 * Create a folder at the current page level (already navigated).
 * Returns the created folder or null. Idempotent.
 */
async function createFolderHere(page, name, color = null) {
  // Check if already exists
  const existing = await findFolderByName(page, name);
  if (existing) {
    console.log(`    Already exists: "${name}" (${existing.id})`);
    return existing;
  }

  await clickAddMaterials(page);
  await sleep(1500);
  await clickAddFolder(page);

  const popupOk = await waitForPopup(page);
  if (!popupOk) {
    console.error(`    Popup did not appear for folder "${name}"`);
    return null;
  }
  await sleep(500);

  await fillFolderForm(page, { name, color });
  await submitPopup(page);

  const created = await findFolderByName(page, name);
  if (created) {
    console.log(`    Created: "${name}" (${created.id})`);
  } else {
    console.warn(`    Warning: could not verify creation of "${name}"`);
  }
  return created;
}

/**
 * Post a single link at the current page level (already navigated).
 */
async function postLinkHere(page, title, url) {
  await clickAddMaterials(page);
  await clickAddFileLink(page);
  await sleep(1500);
  await clickLinkOption(page);

  const popupOk = await waitForPopup(page);
  if (!popupOk) {
    console.error(`    Popup did not appear for link "${title}"`);
    return false;
  }
  await sleep(1000);

  await fillLinkForm(page, { title, url });
  await submitPopup(page);
  console.log(`    Posted: ${title}`);
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const planPath = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!planPath) {
    console.error("Usage: node scripts/schoology-backfill.mjs <plan.json> [--dry-run]");
    process.exit(1);
  }

  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const registry = JSON.parse(readFileSync("state/lesson-registry.json", "utf8"));
  const courseId = plan.courseId;

  console.log(`\nBackfill plan: ${planPath}`);
  console.log(`Course: ${courseId}`);
  console.log(`Actions: ${plan.actions.length}`);
  console.log(`Dry run: ${dryRun}\n`);

  if (dryRun) {
    for (const action of plan.actions) {
      console.log(`Step ${action.step}: [${action.type}] ${action.name || action.folder || ""}`);
      if (action.type === "post-links") {
        for (const lesson of action.lessons) {
          const entry = registry[lesson];
          if (!entry) { console.log(`  ${lesson}: NOT IN REGISTRY`); continue; }
          for (const lt of LINK_TYPES) {
            const url = entry.urls?.[lt.key];
            if (url) console.log(`  ${lt.titleFn(lesson)} → ${url}`);
          }
        }
      }
    }
    console.log("\nDry run complete. No changes made.");
    return;
  }

  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology.com" });

  try {
    let created = 0, moved = 0, posted = 0, skipped = 0;

    for (const action of plan.actions) {
      console.log(`\n── Step ${action.step}: [${action.type}] ${action.name || action.folder || ""}`);

      if (action.type === "create-folder") {
        // Navigate to parent
        if (action.parentPath && action.parentPath.length > 0) {
          const parentId = await navigatePath(page, courseId, action.parentPath);
          if (!parentId) {
            console.error(`  Skipping: could not navigate to parent path`);
            skipped++;
            continue;
          }
        } else if (action.in) {
          // Simple parent — find at top level
          await navigateToFolder(page, courseId);
          const parent = await findFolderByName(page, action.in);
          if (!parent) {
            console.error(`  Skipping: parent folder "${action.in}" not found`);
            skipped++;
            continue;
          }
          await navigateToFolder(page, courseId, parent.id);
        } else {
          // Top level
          await navigateToFolder(page, courseId);
        }

        const result = await createFolderHere(page, action.name, action.color || null);
        if (result) created++;
        else skipped++;

      } else if (action.type === "move-folder") {
        const ok = await cmdMoveFolder(page, courseId, {
          name: action.name,
          into: action.into,
          from: action.from || null,
        });
        if (ok) moved++;
        else skipped++;

      } else if (action.type === "post-links") {
        // Navigate to the target folder
        const targetId = await navigatePath(page, courseId, action.parentPath);
        if (!targetId) {
          console.error(`  Skipping: could not navigate to folder`);
          skipped++;
          continue;
        }

        for (const lesson of action.lessons) {
          const entry = registry[lesson];
          if (!entry) {
            console.log(`  ${lesson}: not in registry, skipping`);
            continue;
          }

          for (const lt of LINK_TYPES) {
            const url = entry.urls?.[lt.key];
            if (!url) continue;

            const title = lt.titleFn(lesson);
            const ok = await postLinkHere(page, title, url);
            if (ok) posted++;

            // Re-navigate after post (page may have redirected)
            if (!page.url().includes(`f=${targetId}`)) {
              await navigateToFolder(page, courseId, targetId);
            }
          }
        }

      } else {
        console.warn(`  Unknown action type: ${action.type}`);
        skipped++;
      }
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log(`Backfill complete!`);
    console.log(`  Folders created: ${created}`);
    console.log(`  Folders moved: ${moved}`);
    console.log(`  Links posted: ${posted}`);
    console.log(`  Skipped: ${skipped}`);

  } finally {
    console.log("\nDisconnecting from browser (CDP). Browser remains open.");
    await browser?.close().catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });
