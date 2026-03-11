#!/usr/bin/env node
/**
 * schoology-repair-orphans.mjs — Detect orphaned materials at the Schoology
 * course root and move them into their correct lesson folders.
 *
 * Usage:
 *   node scripts/schoology-repair-orphans.mjs                      # Preview repairs
 *   node scripts/schoology-repair-orphans.mjs --execute            # Apply via CDP
 *   node scripts/schoology-repair-orphans.mjs --unit 6 --lesson 4  # Single lesson
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROOT } from './lib/paths.mjs';
import { detectOrphans } from './lib/schoology-reconcile.mjs';
import { parseTopicWithAI, batchParseTopics } from './lib/schoology-classify-ai.mjs';
import { loadRegistry } from './lib/lesson-registry.mjs';
import {
  COURSE_IDS,
  materialsUrl,
  navigateToFolder,
  listItems,
  openGearMenu,
  clickMoveOption,
  waitForPopup,
  selectMoveTarget,
  getMoveOptions,
  submitMovePopup,
  sleep,
} from './lib/schoology-dom.mjs';

// ── Paths ──────────────────────────────────────────────────────────────────────
const TREE_PATH = join(AGENT_ROOT, 'state', 'schoology-tree.json');
const LOG_PATH  = join(AGENT_ROOT, 'state', 'orphan-repair-log.json');

// ── CLI Parsing ────────────────────────────────────────────────────────────────
function parseCLI() {
  const args = process.argv.slice(2);
  const opts = { execute: false, unit: null, lesson: null };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--execute':
        opts.execute = true;
        break;
      case '--unit':
        opts.unit = Number(args[++i]);
        break;
      case '--lesson':
        opts.lesson = Number(args[++i]);
        break;
      case '--help':
      case '-h':
        console.log(`Usage: node scripts/schoology-repair-orphans.mjs [options]

Options:
  --execute            Apply moves via CDP (default: preview only)
  --unit <N>           Filter to a single unit
  --lesson <N>         Filter to a single lesson (requires --unit)
  -h, --help           Show this help
`);
        process.exit(0);
    }
  }

  if (opts.lesson != null && opts.unit == null) {
    console.error('Error: --lesson requires --unit');
    process.exit(1);
  }

  return opts;
}

// ── Load Data ──────────────────────────────────────────────────────────────────

function loadTree() {
  if (!existsSync(TREE_PATH)) {
    console.error(`Error: ${TREE_PATH} not found.`);
    console.error('Run the deep scraper first: node scripts/schoology-deep-scrape.mjs');
    process.exit(1);
  }
  return JSON.parse(readFileSync(TREE_PATH, 'utf-8'));
}

function loadRepairLog() {
  try {
    if (existsSync(LOG_PATH)) {
      return JSON.parse(readFileSync(LOG_PATH, 'utf-8'));
    }
  } catch { /* start fresh */ }
  return { lastRun: null, repairs: [] };
}

function saveRepairLog(log) {
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + '\n', 'utf-8');
}

// ── Folder Lookup ──────────────────────────────────────────────────────────────

/**
 * For a given lesson (unit.lesson), determine the target folder ID and path.
 * Strategy: check registry's schoology.folderId first, then fall back to the
 * tree's lessonIndex.
 *
 * @returns {{ folderId: string, folderPath: string[] } | null}
 */
function findTargetFolder(unit, lesson, registry, tree, period = 'B') {
  const key = `${unit}.${lesson}`;

  // Strategy 1: registry has an explicit folderId
  const regEntry = registry[key];
  const schoologyPeriod = regEntry?.schoology?.[period];
  if (schoologyPeriod?.folderId) {
    const folderId = String(schoologyPeriod.folderId);
    const folderPath = schoologyPeriod.folderPath || [];
    // Verify the folder exists in the tree
    if (tree.folders?.[folderId]) {
      return {
        folderId,
        folderPath: tree.folders[folderId].path || folderPath,
      };
    }
    // Folder ID in registry but not in tree — still use it, trust the registry
    return { folderId, folderPath };
  }

  // Strategy 2: tree's lessonIndex
  const treeEntry = tree.lessonIndex?.[key];
  if (treeEntry?.primaryFolder) {
    const folderId = treeEntry.primaryFolder;
    const folderPath = treeEntry.folderPath || [];
    return { folderId, folderPath };
  }

  // Strategy 3: extract folderId from registry's schoologyFolder URL
  const folderUrlKey = period === 'E' ? 'schoologyFolderE' : 'schoologyFolder';
  if (regEntry?.urls?.[folderUrlKey]) {
    const m = regEntry.urls[folderUrlKey].match(/[?&]f=(\d+)/);
    if (m) {
      const folderId = m[1];
      const folder = tree.folders?.[folderId];
      return {
        folderId,
        folderPath: folder?.path || [],
      };
    }
  }

  return null;
}

/**
 * Given an orphan with no parsedLesson, try to find context from its siblings
 * at the root level for the AI parser.
 */
function getRootContext(tree) {
  const rootMaterials = [];
  if (tree.materials) {
    for (const mat of Object.values(tree.materials)) {
      if (mat.folderId === '__root__' || mat.folderId === null) {
        rootMaterials.push(mat.title);
      }
    }
  }
  return { folderPath: ['__root__'], siblingTitles: rootMaterials.slice(0, 10) };
}

// ── CDP Move ───────────────────────────────────────────────────────────────────

/**
 * Move a material (link/resource) into a target folder using CDP.
 *
 * Uses the gear menu → Move → select destination → submit workflow, same
 * pattern as schoology-commands-move.mjs but for materials (n- rows) not
 * folders (f- rows).
 */
async function moveMaterialToFolder(page, courseId, materialId, targetFolderId, targetFolderName) {
  // Navigate to the course root where orphans live
  await navigateToFolder(page, courseId);

  // Find the material row — materials use "n-{id}" row IDs
  const rowId = `n-${materialId}`;

  // Verify the row exists on the page
  const rowExists = await page.evaluate((rid) => {
    return !!document.getElementById(rid);
  }, rowId);

  if (!rowExists) {
    // Try alternate ID format: "s-{id}" for some material types
    const altRowId = `s-${materialId}`;
    const altExists = await page.evaluate((rid) => {
      return !!document.getElementById(rid);
    }, altRowId);

    if (!altExists) {
      return { success: false, error: `Material row not found (tried #${rowId} and #${altRowId})` };
    }
    // Use the alternate row ID
    return await doMoveViaGearMenu(page, altRowId, targetFolderName);
  }

  return await doMoveViaGearMenu(page, rowId, targetFolderName);
}

async function doMoveViaGearMenu(page, rowId, targetFolderName) {
  try {
    // Open gear/action menu
    await openGearMenu(page, rowId);
    await sleep(1000);

    // Click "Move" in the dropdown
    await clickMoveOption(page, rowId);

    // Wait for move popup
    const popupLoaded = await waitForPopup(page);
    if (!popupLoaded) {
      return { success: false, error: 'Move popup did not appear' };
    }
    await sleep(1500);

    // Select target folder in dropdown
    const selected = await selectMoveTarget(page, targetFolderName);
    if (!selected.found) {
      const options = await getMoveOptions(page);
      const optionNames = options.map(o => o.text).join(', ');
      return {
        success: false,
        error: `Target folder "${targetFolderName}" not found in dropdown. Available: ${optionNames}`,
      };
    }

    // Submit the move
    await submitMovePopup(page);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseCLI();
  const tree = loadTree();
  const registry = loadRegistry();
  const period = tree.meta?.coursePeriod || 'B';
  const courseId = tree.meta?.courseId || COURSE_IDS.B;

  console.log('=== Schoology Orphan Repair ===');
  console.log(`Mode: ${opts.execute ? 'EXECUTE (will move materials)' : 'PREVIEW (dry run)'}`);
  console.log(`Tree scraped at: ${tree.meta?.scrapedAt || 'unknown'}`);
  console.log();

  // Step 1: Detect orphans
  const allOrphans = detectOrphans(tree);
  console.log(`Found ${allOrphans.length} material(s) at course root.`);
  console.log();

  if (allOrphans.length === 0) {
    console.log('No orphans to repair. Done.');
    return;
  }

  // Step 2: Parse lessons for orphans that don't already have one
  //         Use batch AI for efficiency.
  const needsAI = [];
  const rootContext = getRootContext(tree);

  for (const orphan of allOrphans) {
    if (!orphan.parsedLesson) {
      needsAI.push({ title: orphan.title, context: rootContext });
    }
  }

  let aiResults = new Map();
  if (needsAI.length > 0) {
    console.log(`Parsing ${needsAI.length} unresolved title(s) via regex + AI fallback...`);
    aiResults = await batchParseTopics(needsAI);
    console.log();
  }

  // Step 3: Build repair plan
  const queued = [];
  const skipped = [];

  for (const orphan of allOrphans) {
    // Determine lesson for this orphan
    let lessonInfo = null;

    if (orphan.parsedLesson) {
      lessonInfo = { unit: orphan.parsedLesson.unit, lesson: orphan.parsedLesson.lesson, source: 'tree' };
    } else if (aiResults.has(orphan.title)) {
      lessonInfo = aiResults.get(orphan.title); // may be null
    }

    // Apply unit/lesson filter if specified
    if (opts.unit != null) {
      if (!lessonInfo || lessonInfo.unit !== opts.unit) {
        continue; // skip orphans not matching the filter
      }
      if (opts.lesson != null && lessonInfo.lesson !== opts.lesson) {
        continue;
      }
    }

    if (!lessonInfo) {
      skipped.push({
        materialId: orphan.materialId,
        title: orphan.title,
        reason: 'Could not determine lesson from title',
        parsedType: orphan.parsedType,
      });
      console.log(`[SKIP] "${orphan.title}" (${orphan.materialId}) -- could not determine lesson`);
      continue;
    }

    // Look up target folder
    const target = findTargetFolder(lessonInfo.unit, lessonInfo.lesson, registry, tree, period);
    if (!target) {
      skipped.push({
        materialId: orphan.materialId,
        title: orphan.title,
        reason: `Lesson ${lessonInfo.unit}.${lessonInfo.lesson} has no known folder`,
        parsedType: orphan.parsedType,
      });
      console.log(`[SKIP] "${orphan.title}" (${orphan.materialId}) -- lesson ${lessonInfo.unit}.${lessonInfo.lesson} has no known folder`);
      continue;
    }

    const folderTitle = tree.folders?.[target.folderId]?.title || target.folderId;

    queued.push({
      materialId: orphan.materialId,
      title: orphan.title,
      lesson: `${lessonInfo.unit}.${lessonInfo.lesson}`,
      unit: lessonInfo.unit,
      lessonNum: lessonInfo.lesson,
      parsedType: orphan.parsedType,
      source: lessonInfo.source || 'unknown',
      toFolder: target.folderId,
      toFolderPath: target.folderPath,
      toFolderTitle: folderTitle,
    });

    console.log(
      `[QUEUE] "${orphan.title}" -> folder ${target.folderId} (${target.folderPath.join('/')})`
    );
  }

  // Step 4: Summary
  console.log();
  console.log('--- Summary ---');
  console.log(`Total root materials:  ${allOrphans.length}`);
  console.log(`Queued for move:       ${queued.length}`);
  console.log(`Skipped:               ${skipped.length}`);
  console.log();

  if (queued.length === 0) {
    console.log('Nothing to move. Done.');
    return;
  }

  // Step 5: Execute or print manual instructions
  const repairLog = loadRepairLog();
  const runTimestamp = new Date().toISOString();

  if (opts.execute) {
    // Connect CDP
    let chromium;
    try {
      const pw = await import('playwright');
      chromium = pw.chromium;
    } catch {
      console.error('Error: playwright not installed. Run: npm install playwright');
      process.exit(1);
    }

    const { connectCDP } = await import('./lib/cdp-connect.mjs');
    const { browser, page } = await connectCDP(chromium, { preferUrl: 'schoology' });

    console.log('Executing moves via CDP...');
    console.log();

    let successCount = 0;
    let failCount = 0;

    for (const item of queued) {
      console.log(`Moving "${item.title}" (${item.materialId}) -> ${item.toFolderPath.join('/')}...`);

      const result = await moveMaterialToFolder(
        page,
        courseId,
        item.materialId,
        item.toFolder,
        item.toFolderTitle,
      );

      const repair = {
        materialId: item.materialId,
        title: item.title,
        lesson: item.lesson,
        fromFolder: '__root__',
        toFolder: item.toFolder,
        toFolderPath: item.toFolderPath,
        status: result.success ? 'moved' : 'failed',
        error: result.error || null,
        timestamp: new Date().toISOString(),
      };

      repairLog.repairs.push(repair);

      if (result.success) {
        console.log(`  [OK] Moved successfully.`);
        successCount++;
      } else {
        console.log(`  [FAIL] ${result.error}`);
        failCount++;

        // Print manual fallback for failed moves
        printManualInstructions(item, courseId);

        // Stop on failure to avoid cascading issues
        console.log();
        console.log('Stopping after failure. Fix and re-run to continue.');
        break;
      }

      // Brief pause between moves to avoid overwhelming Schoology
      await sleep(2000);
    }

    console.log();
    console.log(`Moves complete: ${successCount} succeeded, ${failCount} failed.`);

    await browser.close().catch(() => {});
  } else {
    // Preview mode: print manual instructions for each queued item
    console.log('=== Manual Instructions (run with --execute to automate) ===');
    console.log();

    for (const item of queued) {
      printManualInstructions(item, courseId);

      repairLog.repairs.push({
        materialId: item.materialId,
        title: item.title,
        lesson: item.lesson,
        fromFolder: '__root__',
        toFolder: item.toFolder,
        toFolderPath: item.toFolderPath,
        status: 'manual',
        timestamp: runTimestamp,
      });
    }
  }

  // Step 6: Log skipped items
  for (const item of skipped) {
    repairLog.repairs.push({
      materialId: item.materialId,
      title: item.title,
      lesson: null,
      fromFolder: '__root__',
      toFolder: null,
      toFolderPath: null,
      status: 'skipped',
      reason: item.reason,
      timestamp: runTimestamp,
    });
  }

  // Save log
  repairLog.lastRun = runTimestamp;
  saveRepairLog(repairLog);
  console.log(`Log saved to: ${LOG_PATH}`);
}

function printManualInstructions(item, courseId) {
  console.log(`[MANUAL] To move "${item.title}" (ID: ${item.materialId}):`);
  console.log(`  1. Open: ${materialsUrl(courseId)}`);
  console.log(`  2. Find the material at the course root`);
  console.log(`  3. Drag it into the folder: ${item.toFolderPath.join(' > ')} (ID: ${item.toFolder})`);
  console.log();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
