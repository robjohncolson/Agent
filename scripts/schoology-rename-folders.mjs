#!/usr/bin/env node
/**
 * schoology-rename-folders.mjs — Preview or apply Schoology folder name standardization.
 *
 * Loads the scraped tree, runs the folder-name standardizer, and prints a
 * rename plan.  With --execute applies renames via CDP (gear menu → Edit → change title).
 * With --ai uses DeepSeek to parse folder names that regex can't handle.
 *
 * Usage:
 *   node scripts/schoology-rename-folders.mjs                # Preview renames
 *   node scripts/schoology-rename-folders.mjs --ai           # Preview + AI for unparseable
 *   node scripts/schoology-rename-folders.mjs --execute      # Apply via CDP
 *   node scripts/schoology-rename-folders.mjs --execute --ai # Apply + AI
 *   node scripts/schoology-rename-folders.mjs --tree path    # Custom tree path
 *   node scripts/schoology-rename-folders.mjs --course E     # Period E course
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AGENT_ROOT } from './lib/paths.mjs';
import {
  planFolderRenames,
  standardizeFolderName,
  isDayFolder,
  shouldSkipFolder,
  batchResolveUnparseableWithAI,
} from './lib/folder-name-standardizer.mjs';
import {
  COURSE_IDS,
  navigateToFolder,
  openGearMenu,
  clickEditFolder,
  fillFolderForm,
  submitPopup,
  waitForPopup,
  sleep,
} from './lib/schoology-dom.mjs';

// ── CLI argument parsing ──────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    execute: { type: 'boolean', default: false },
    ai:      { type: 'boolean', default: false },
    course:  { type: 'string',  short: 'c', default: 'B' },
    tree:    { type: 'string',  short: 't', default: '' },
    help:    { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: node scripts/schoology-rename-folders.mjs [options]

Options:
  --execute     Apply renames via CDP (navigates to each folder's parent, edits title)
  --ai          Use DeepSeek to parse folder names that regex can't handle
  --course, -c  Course period letter (B or E, default: B)
  --tree PATH   Path to a custom schoology-tree.json
  -h, --help    Show this help message
`);
  process.exit(0);
}

const courseKey = args.course.toUpperCase();
const courseId = COURSE_IDS[courseKey];
if (!courseId) {
  console.error(`Unknown course "${args.course}". Valid: ${Object.keys(COURSE_IDS).join(', ')}`);
  process.exit(1);
}

// ── Load tree ─────────────────────────────────────────────────────────────────

const treePath = args.tree
  ? resolve(args.tree)
  : join(AGENT_ROOT, 'state', 'schoology-tree.json');

if (!existsSync(treePath)) {
  console.error(`[error] Tree file not found: ${treePath}`);
  console.error('Run the deep scraper first, or pass --tree to point at a different file.');
  process.exit(1);
}

let tree;
try {
  tree = JSON.parse(readFileSync(treePath, 'utf-8'));
} catch (err) {
  console.error(`[error] Failed to parse tree: ${err.message}`);
  process.exit(1);
}

// ── Plan renames (regex pass) ────────────────────────────────────────────────

const { renames, skipped } = planFolderRenames(tree);

// ── AI pass for unparseable day-folders ──────────────────────────────────────

const aiRenames = [];

if (args.ai) {
  const unparseable = skipped.filter(s => s.reason === 'unparseable date');

  if (unparseable.length > 0) {
    console.log(`AI pass: ${unparseable.length} unparseable day-folder(s)...\n`);

    const titles = unparseable.map(s => s.title);
    const aiResults = await batchResolveUnparseableWithAI(titles);

    for (const item of unparseable) {
      const parsed = aiResults.get(item.title);
      if (parsed) {
        const newTitle = `${parsed.dayOfWeek} ${parsed.month}/${parsed.day}/${parsed.year}`;
        aiRenames.push({
          folderId: item.folderId,
          oldTitle: item.title,
          newTitle,
          source: 'ai',
        });
        console.log(`  [AI] "${item.title}" → ${newTitle}`);
      } else {
        console.log(`  [AI] "${item.title}" → could not resolve`);
      }
    }

    if (aiRenames.length > 0) {
      console.log(`\n  AI resolved: ${aiRenames.length}/${unparseable.length}\n`);
    } else {
      console.log(`\n  AI resolved: 0/${unparseable.length}\n`);
    }
  } else {
    console.log('AI pass: no unparseable day-folders found.\n');
  }
}

// ── Merge regex + AI renames ─────────────────────────────────────────────────

const allRenames = [
  ...renames.map(r => ({ ...r, source: 'regex' })),
  ...aiRenames,
];

// ── Print preview ─────────────────────────────────────────────────────────────

console.log('=== Schoology Folder Name Standardization ===\n');

if (allRenames.length === 0) {
  console.log('No renames needed — all day folders are already standardized (or unresolvable).\n');
} else {
  console.log(`${allRenames.length} folder(s) to rename:\n`);

  const maxOld = Math.max(...allRenames.map(r => r.oldTitle.length));

  for (const r of allRenames) {
    const pad = ' '.repeat(maxOld - r.oldTitle.length);
    const tag = r.source === 'ai' ? ' [AI]' : '';
    console.log(`  ${r.oldTitle}${pad}  →  ${r.newTitle}${tag}`);
  }
}

// Show remaining skipped (exclude ones AI resolved)
const aiResolvedTitles = new Set(aiRenames.map(r => r.oldTitle));
const remainingSkipped = skipped.filter(s => !aiResolvedTitles.has(s.title));

if (remainingSkipped.length > 0) {
  console.log(`\n${remainingSkipped.length} day-folder(s) skipped:`);
  for (const s of remainingSkipped) {
    console.log(`  [${s.reason}] ${s.title}`);
  }
}

// ── Execute mode ──────────────────────────────────────────────────────────────

if (args.execute) {
  if (allRenames.length === 0) {
    console.log('\nNothing to rename. Done.');
  } else {
    console.log(`\nExecuting ${allRenames.length} rename(s) via CDP...`);
    console.log(`Course: Period ${courseKey} (${courseId})\n`);

    // Connect via CDP
    let chromium;
    try {
      const pw = await import('playwright');
      chromium = pw.chromium;
    } catch {
      console.error('Error: playwright not installed. Run: npm install playwright');
      process.exit(1);
    }

    const { connectCDP } = await import('./lib/cdp-connect.mjs');
    let browser, page;
    try {
      ({ browser, page } = await connectCDP(chromium, { preferUrl: 'schoology' }));
    } catch (err) {
      console.error(`CDP connection failed: ${err.message}`);
      console.error('Make sure Edge is running with --remote-debugging-port=9222');
      process.exit(1);
    }

    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (const rename of allRenames) {
      const folder = tree.folders?.[rename.folderId];
      const parentId = folder?.parentId || null;

      console.log(`Renaming "${rename.oldTitle}" → "${rename.newTitle}"...`);

      try {
        // Navigate to the parent folder (where this folder row is visible)
        await navigateToFolder(page, courseId, parentId);
        await sleep(1000);

        // Verify the folder row exists
        const rowId = `f-${rename.folderId}`;
        const rowExists = await page.evaluate((rid) => {
          return !!document.getElementById(rid);
        }, rowId);

        if (!rowExists) {
          throw new Error(`Folder row #${rowId} not found on page`);
        }

        // Open gear menu → click Edit
        await openGearMenu(page, rowId);
        await clickEditFolder(page, rowId);

        // Wait for the edit popup to appear
        const popupReady = await waitForPopup(page);
        if (!popupReady) {
          throw new Error('Edit popup did not appear');
        }
        await sleep(500);

        // Clear and fill the title field with the new name
        await page.evaluate(() => {
          const titleField = document.querySelector('#edit-title');
          if (titleField) {
            titleField.value = '';
            titleField.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        await fillFolderForm(page, { name: rename.newTitle });

        // Submit
        await submitPopup(page);

        console.log(`  [OK] Renamed successfully.`);
        successCount++;
        results.push({ ...rename, status: 'renamed' });

      } catch (err) {
        console.log(`  [FAIL] ${err.message}`);
        failCount++;
        results.push({ ...rename, status: 'failed', error: err.message });

        // Stop on failure to avoid cascading issues
        console.log('\nStopping after failure. Fix and re-run to continue.');
        break;
      }

      // Brief pause between renames
      await sleep(1500);
    }

    console.log();
    console.log(`Renames complete: ${successCount} succeeded, ${failCount} failed.`);

    // Don't close the browser — user may still need it
  }
}

// ── Write log ─────────────────────────────────────────────────────────────────

const logPath = join(AGENT_ROOT, 'state', 'folder-rename-log.json');
const logEntry = {
  timestamp: new Date().toISOString(),
  treePath,
  executed: args.execute,
  aiEnabled: args.ai,
  course: courseKey,
  totalRenames: allRenames.length,
  regexRenames: renames.length,
  aiRenames: aiRenames.length,
  totalSkipped: remainingSkipped.length,
  renames: allRenames,
  skipped: remainingSkipped,
};

let existingLog = [];
if (existsSync(logPath)) {
  try {
    existingLog = JSON.parse(readFileSync(logPath, 'utf-8'));
    if (!Array.isArray(existingLog)) existingLog = [existingLog];
  } catch {
    existingLog = [];
  }
}
existingLog.push(logEntry);
writeFileSync(logPath, JSON.stringify(existingLog, null, 2) + '\n');
console.log(`\nLog written to ${logPath}`);
