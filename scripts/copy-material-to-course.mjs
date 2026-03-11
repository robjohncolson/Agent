#!/usr/bin/env node
/**
 * copy-material-to-course.mjs — Copy Schoology materials from one course to another.
 *
 * Uses Schoology's "Copy to Course" dialog via CDP to copy materials from
 * Period B to Period E (or any source → target course).
 *
 * Usage:
 *   node scripts/copy-material-to-course.mjs --unit 6 --lesson 5 --to-period E
 *   node scripts/copy-material-to-course.mjs --unit 6 --lesson 5 --to-period E --only blooket
 *   node scripts/copy-material-to-course.mjs --unit 6 --lesson 5 --to-period E --dry-run
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

import { chromium } from 'playwright';
import { connectCDP } from './lib/cdp-connect.mjs';
import {
  COURSE_IDS,
  navigateToFolder,
  listItems,
  openGearMenu,
  waitForPopup,
  clickCopyToCourse,
  selectCopyTarget,
  submitCopyPopup,
  sleep,
} from './lib/schoology-dom.mjs';
import {
  getLesson,
  getSchoologyState,
  updateSchoologyMaterial,
} from './lib/lesson-registry.mjs';

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    unit: null,
    lesson: null,
    fromPeriod: 'B',
    toPeriod: null,
    fromCourse: null,
    toCourse: null,
    only: null,
    dryRun: false,
    noPrompt: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--unit': case '-u': opts.unit = Number(args[++i]); break;
      case '--lesson': case '-l': opts.lesson = Number(args[++i]); break;
      case '--from-period': opts.fromPeriod = args[++i].toUpperCase(); break;
      case '--to-period': opts.toPeriod = args[++i].toUpperCase(); break;
      case '--from-course': opts.fromCourse = args[++i]; break;
      case '--to-course': opts.toCourse = args[++i]; break;
      case '--only': opts.only = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--no-prompt': opts.noPrompt = true; break;
      case '--help': case '-h':
        console.log(`Usage: node scripts/copy-material-to-course.mjs [options]

Options:
  --unit, -u <N>       Unit number (required)
  --lesson, -l <N>     Lesson number (required)
  --to-period <P>      Target period: B or E (required unless --to-course)
  --from-period <P>    Source period (default: B)
  --from-course <id>   Source course ID (default: derives from --from-period)
  --to-course <id>     Target course ID (default: derives from --to-period)
  --only <type>        Copy only this material type (worksheet, drills, quiz, blooket)
  --dry-run            Show what would be copied, don't execute
  --no-prompt          Non-interactive mode
  --help, -h           Show this help
`);
        process.exit(0);
    }
  }

  // Derive course IDs from period letters
  if (!opts.fromCourse) opts.fromCourse = COURSE_IDS[opts.fromPeriod];
  if (!opts.toCourse && opts.toPeriod) opts.toCourse = COURSE_IDS[opts.toPeriod];
  if (!opts.toPeriod && opts.toCourse) {
    opts.toPeriod = Object.entries(COURSE_IDS).find(([, v]) => v === opts.toCourse)?.[0] || '?';
  }

  if (!opts.unit || !opts.lesson) {
    console.error('Error: --unit and --lesson are required.');
    process.exit(1);
  }
  if (!opts.toCourse) {
    console.error('Error: --to-period or --to-course is required.');
    process.exit(1);
  }

  return opts;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const { unit, lesson, fromPeriod, toPeriod, fromCourse, toCourse } = opts;
  const key = `${unit}.${lesson}`;

  console.log('');
  console.log('=== Copy Material to Course ===');
  console.log(`  Lesson:  ${key}`);
  console.log(`  From:    Period ${fromPeriod} (${fromCourse})`);
  console.log(`  To:      Period ${toPeriod} (${toCourse})`);
  if (opts.only) console.log(`  Only:    ${opts.only}`);
  console.log('');

  // Step 1: Read registry
  const entry = getLesson(unit, lesson);
  if (!entry) {
    console.error(`Error: No registry entry for ${key}`);
    process.exit(1);
  }

  const sourceSchoology = entry.schoology?.[fromPeriod];
  const targetSchoology = entry.schoology?.[toPeriod];

  if (!sourceSchoology?.folderId) {
    console.error(`Error: No source folder for Period ${fromPeriod} in registry.`);
    process.exit(1);
  }
  if (!targetSchoology?.folderId) {
    console.error(`Error: No target folder for Period ${toPeriod} in registry.`);
    console.error(`  Run the scraper/reconciler first to establish the Period ${toPeriod} folder.`);
    process.exit(1);
  }

  const sourceFolderId = sourceSchoology.folderId;
  const targetFolderId = targetSchoology.folderId;

  console.log(`  Source folder: ${sourceFolderId}`);
  console.log(`  Target folder: ${targetFolderId}`);

  // Step 2: Build copy list from source materials
  const sourceMaterials = sourceSchoology.materials || {};
  const targetMaterials = targetSchoology.materials || {};

  const toCopy = [];
  for (const [type, mat] of Object.entries(sourceMaterials)) {
    if (type === 'videos') continue; // Handle videos separately if needed
    if (!mat?.schoologyId) continue;
    if (opts.only && type !== opts.only) continue;

    // Skip if already exists in target
    const existing = targetMaterials[type];
    if (existing?.schoologyId) {
      console.log(`  [skip] ${type}: already exists in target (${existing.schoologyId})`);
      continue;
    }

    toCopy.push({
      type,
      schoologyId: mat.schoologyId,
      title: mat.title || `${type} ${key}`,
    });
  }

  if (toCopy.length === 0) {
    console.log('\nNothing to copy — all materials already exist in target.');
    return;
  }

  console.log(`\n  ${toCopy.length} material(s) to copy:`);
  for (const m of toCopy) {
    console.log(`    ${m.type}: ${m.title} (${m.schoologyId})`);
  }

  if (opts.dryRun) {
    console.log('\nDry run — no actions taken.');
    return;
  }

  // Step 3: Connect via CDP
  console.log('\nConnecting to browser...');
  const { browser, page } = await connectCDP(chromium, { preferUrl: 'schoology.com' });

  let succeeded = 0;
  let failed = 0;

  try {
    // Step 4: Navigate to source folder
    console.log(`\nNavigating to source folder (Period ${fromPeriod})...`);
    await navigateToFolder(page, fromCourse, sourceFolderId);
    await sleep(1000);

    // Step 5: Copy each material
    for (const mat of toCopy) {
      const rowId = `n-${mat.schoologyId}`;
      console.log(`\nCopying "${mat.title}" (${mat.type})...`);

      try {
        // Open gear menu
        console.log('  Opening gear menu...');
        await openGearMenu(page, rowId);

        // Click Copy to Course
        console.log('  Clicking Copy to Course...');
        await clickCopyToCourse(page, rowId);

        // Wait for popup
        console.log('  Waiting for dialog...');
        const popupOk = await waitForPopup(page, 10000);
        if (!popupOk) throw new Error('Copy to Course dialog did not appear');
        await sleep(500);

        // Select target course and folder
        console.log(`  Selecting Period ${toPeriod} folder ${targetFolderId}...`);
        const selectResult = await selectCopyTarget(page, toCourse, targetFolderId);
        if (!selectResult.success) throw new Error(selectResult.error);
        await sleep(500);

        // Submit
        console.log('  Submitting...');
        await submitCopyPopup(page);

        console.log('  [OK] Copied successfully.');
        succeeded++;

        // Update registry — we don't know the new schoologyId yet (reconciler will find it)
        updateSchoologyMaterial(unit, lesson, mat.type, {
          title: mat.title,
          copiedFrom: fromPeriod,
          copiedFromId: mat.schoologyId,
          copiedAt: new Date().toISOString(),
          status: 'done',
        }, toPeriod);

        // Re-navigate to source folder for next material
        if (toCopy.indexOf(mat) < toCopy.length - 1) {
          await navigateToFolder(page, fromCourse, sourceFolderId);
          await sleep(1000);
        }
      } catch (err) {
        console.error(`  [FAIL] ${err.message}`);
        failed++;

        // Try to dismiss any stale popup and re-navigate
        try {
          await page.evaluate(() => {
            const close = document.querySelector('.popups-close a');
            if (close) close.click();
          });
          await sleep(1000);
          await navigateToFolder(page, fromCourse, sourceFolderId);
          await sleep(1000);
        } catch { /* best effort */ }
      }
    }
  } finally {
    await browser.close();
  }

  // Summary
  console.log('');
  console.log('=== Copy Complete ===');
  console.log(`  ${succeeded} succeeded, ${failed} failed`);
  console.log('');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
