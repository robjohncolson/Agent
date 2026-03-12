#!/usr/bin/env node
/**
 * cleanup-73-folders.mjs — One-time cleanup for the botched 7.3 folder placement.
 *
 * Deletes:
 * 1. Duplicate "work-ahead" folder trees in both courses (created by split bug)
 * 2. Orphaned 7.3 links at root level in both courses (from original bad post)
 *
 * Then re-posts 7.3 correctly using the existing folder hierarchy.
 */

import { chromium } from 'playwright';
import { connectCDP } from './lib/cdp-connect.mjs';
import {
  navigateToFolder, listItems, sleep, COURSE_IDS,
  clickAddMaterials, clickAddFolder, fillFolderForm, submitPopup,
} from './lib/schoology-dom.mjs';

const COURSES = [
  { id: COURSE_IDS.B, period: 'B', dupFolderId: '987262909' },
  { id: COURSE_IDS.E, period: 'E', dupFolderId: '987262950' },
];

async function deleteFolder(page, courseId, folderId) {
  // Navigate to the folder's parent to find it in the list
  await navigateToFolder(page, courseId);
  await sleep(1000);

  // Open gear menu for the folder
  const rowId = `f-${folderId}`;
  try {
    await page.click(`#${rowId} .action-links-unfold`, { timeout: 5000 });
    await sleep(1000);

    // Click Delete
    const deleted = await page.evaluate((rid) => {
      const row = document.getElementById(rid);
      if (!row) return false;
      const links = row.querySelectorAll('.action-links a, a');
      for (const a of links) {
        if (a.textContent.trim().toLowerCase().includes('delete')) {
          a.click();
          return true;
        }
      }
      return false;
    }, rowId);

    if (deleted) {
      await sleep(2000);
      // Confirm deletion in popup
      const confirmed = await page.evaluate(() => {
        const btns = document.querySelectorAll('.popups-box input[type="submit"], .popups-box button');
        for (const btn of btns) {
          if (btn.value?.toLowerCase().includes('delete') || btn.textContent?.toLowerCase().includes('delete')) {
            btn.click();
            return true;
          }
        }
        // Try any submit button in the popup
        const submit = document.querySelector('.popups-box input[type="submit"]');
        if (submit) { submit.click(); return true; }
        return false;
      });
      if (confirmed) {
        await sleep(3000);
        console.log(`  Deleted folder ${folderId}`);
        return true;
      }
    }
  } catch (e) {
    console.log(`  Could not delete folder ${folderId}: ${e.message}`);
  }
  return false;
}

async function deleteOrphanLinks(page, courseId, unit, lesson) {
  await navigateToFolder(page, courseId);
  await sleep(1000);
  const items = await listItems(page);

  const topicPrefix = `Topic ${unit}.${lesson}`;
  const quizPrefix = `Quiz ${unit}.${lesson - 1}`;
  const orphans = items.filter(i =>
    i.type === 'link' && (
      i.name.startsWith(topicPrefix) ||
      i.name.startsWith(quizPrefix) ||
      i.name.includes(`${unit}.${lesson} —`) ||
      i.name.includes(`AP Classroom Video`)
    )
  );

  console.log(`  Found ${orphans.length} orphan link(s) at root`);
  let deleted = 0;

  for (const orphan of orphans) {
    try {
      // Navigate back to root each time (DOM refreshes after delete)
      await navigateToFolder(page, courseId);
      await sleep(1000);

      const rowId = `n-${orphan.id}`;
      await page.click(`#${rowId} .action-links-unfold`, { timeout: 5000 });
      await sleep(1000);

      const clicked = await page.evaluate((rid) => {
        const row = document.getElementById(rid);
        if (!row) return false;
        const links = row.querySelectorAll('.action-links a, a');
        for (const a of links) {
          if (a.textContent.trim().toLowerCase().includes('delete')) {
            a.click();
            return true;
          }
        }
        return false;
      }, rowId);

      if (clicked) {
        await sleep(2000);
        await page.evaluate(() => {
          const submit = document.querySelector('.popups-box input[type="submit"]');
          if (submit) submit.click();
        });
        await sleep(3000);
        console.log(`    Deleted: "${orphan.name}"`);
        deleted++;
      }
    } catch (e) {
      console.log(`    Failed to delete "${orphan.name}": ${e.message}`);
    }
  }

  return deleted;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Connecting to browser via CDP...');
  const { browser, page } = await connectCDP(chromium, { preferUrl: 'schoology.com' });

  for (const course of COURSES) {
    console.log(`\n=== Period ${course.period} (${course.id}) ===`);

    if (dryRun) {
      console.log(`  Would delete duplicate folder: ${course.dupFolderId}`);
      console.log(`  Would delete orphan 7.3 links at root`);
      continue;
    }

    // Step 1: Delete the duplicate "work-ahead" folder (and everything inside it)
    console.log(`  Deleting duplicate "work-ahead" folder (${course.dupFolderId})...`);
    await deleteFolder(page, course.id, course.dupFolderId);

    // Step 2: Delete orphaned 7.3 links at root
    console.log(`  Cleaning up orphan 7.3 links at root...`);
    const deleted = await deleteOrphanLinks(page, course.id, 7, 3);
    console.log(`  Deleted ${deleted} orphan link(s)`);
  }

  console.log('\nDone. Disconnecting.');
  if (browser) await browser.close();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
