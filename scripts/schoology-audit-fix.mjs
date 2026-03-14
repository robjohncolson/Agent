#!/usr/bin/env node
/**
 * schoology-audit-fix.mjs — Audit and fix Schoology folder structure issues.
 *
 * Detects and fixes:
 * 1. Duplicate day folders (same name within a week folder)
 * 2. Misnamed week folders (not matching /^Week \d+$/)
 * 3. Orphan topic/quiz links at course root level
 *
 * Usage:
 *   node scripts/schoology-audit-fix.mjs              # dry-run audit
 *   node scripts/schoology-audit-fix.mjs --execute     # fix issues
 *   node scripts/schoology-audit-fix.mjs --period B    # one period only
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectCDP } from './lib/cdp-connect.mjs';
import {
  navigateToFolder, listItems, sleep, COURSE_IDS,
  materialsUrl as buildMaterialsUrl, findFolderByName,
  openGearMenu, submitPopup, waitForPopup, waitForPopupClose,
} from './lib/schoology-dom.mjs';
import { AGENT_ROOT } from './lib/paths.mjs';

const LOG_PATH = join(AGENT_ROOT, 'state', 'audit-fix-log.json');

// ── CLI Parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const periodFilter = args.includes('--period')
  ? args[args.indexOf('--period') + 1]?.toUpperCase()
  : null;

const COURSES = [
  { id: COURSE_IDS.B, period: 'B' },
  { id: COURSE_IDS.E, period: 'E' },
].filter(c => !periodFilter || c.period === periodFilter);

if (COURSES.length === 0) {
  console.error(`No courses match --period ${periodFilter}. Use B or E.`);
  process.exit(1);
}

// ── Audit Data ───────────────────────────────────────────────────────────────

const auditLog = {
  timestamp: new Date().toISOString(),
  mode: execute ? 'execute' : 'dry-run',
  courses: {},
};

// ── DOM Helpers ──────────────────────────────────────────────────────────────

/**
 * Delete a Schoology item (folder or link) via its gear menu.
 * Assumes we're already on the page where the item is listed.
 */
async function deleteItem(page, rowId) {
  try {
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

    if (!clicked) return false;

    await sleep(2000);
    const confirmed = await page.evaluate(() => {
      const btns = document.querySelectorAll('.popups-box input[type="submit"], .popups-box button');
      for (const btn of btns) {
        if (btn.value?.toLowerCase().includes('delete') || btn.textContent?.toLowerCase().includes('delete')) {
          btn.click();
          return true;
        }
      }
      const submit = document.querySelector('.popups-box input[type="submit"]');
      if (submit) { submit.click(); return true; }
      return false;
    });

    if (confirmed) {
      await sleep(3000);
      return true;
    }
  } catch (e) {
    console.error(`    Failed to delete ${rowId}: ${e.message}`);
  }
  return false;
}

/**
 * Move all items from one folder into another using the Move option.
 * Uses targetFolderId to select the correct dropdown option (avoids ambiguity
 * when multiple folders share the same name, e.g. duplicate day folders).
 * Returns count of items moved.
 */
async function moveItemsToFolder(page, courseId, sourceFolderId, targetFolderId) {
  await navigateToFolder(page, courseId, sourceFolderId);
  const items = await listItems(page);

  if (items.length === 0) return 0;

  let moved = 0;
  for (const item of items) {
    // Navigate back to source folder each time (DOM refreshes after move)
    await navigateToFolder(page, courseId, sourceFolderId);

    const rowId = item.type === 'folder' ? `f-${item.id}` : `n-${item.id}`;
    try {
      await page.click(`#${rowId} .action-links-unfold`, { timeout: 5000 });
      await sleep(1000);

      // Click Move
      const moveClicked = await page.evaluate((rid) => {
        const row = document.getElementById(rid);
        if (!row) return false;
        const link = row.querySelector('a.move-material');
        if (link) { link.click(); return true; }
        // Fallback: text match
        const links = row.querySelectorAll('.action-links a, a');
        for (const a of links) {
          if (a.textContent.trim().toLowerCase() === 'move') {
            a.click();
            return true;
          }
        }
        return false;
      }, rowId);

      if (!moveClicked) {
        console.log(`      Could not click Move for "${item.name}"`);
        continue;
      }

      await sleep(2000);

      // Select destination folder by ID in the dropdown (avoids name ambiguity)
      const selected = await page.evaluate((folderId) => {
        const sel = document.querySelector('#edit-destination-folder');
        if (!sel) return { found: false, error: 'no select found' };
        for (const opt of sel.options) {
          if (opt.value === folderId) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return { found: true, value: opt.value };
          }
        }
        return { found: false };
      }, targetFolderId);

      if (!selected.found) {
        console.log(`      Could not find target folder ID ${targetFolderId} in move dropdown`);
        // Close popup
        await page.evaluate(() => {
          const popup = document.querySelector('.popups-box');
          if (popup) popup.style.display = 'none';
        });
        await sleep(500);
        continue;
      }

      // Submit the move
      await page.evaluate(() => {
        const popup = document.querySelector('.popups-box');
        if (!popup) return;
        const btn = popup.querySelector('input[type="submit"], button[type="submit"]');
        if (btn) btn.click();
      });
      await waitForPopupClose(page);
      await sleep(2000);

      moved++;
      console.log(`      Moved: "${item.name}"`);
    } catch (e) {
      console.log(`      Failed to move "${item.name}": ${e.message}`);
    }
  }
  return moved;
}

/**
 * Rename a folder via gear menu → Edit → change title → submit.
 * IMPORTANT: Caller must already be on the parent page where the folder row
 * (#f-{folderId}) is visible in the DOM. This function does NOT navigate.
 */
async function renameFolder(page, folderId, newName) {
  const rowId = `f-${folderId}`;

  try {
    await page.click(`#${rowId} .action-links-unfold`, { timeout: 5000 });
    await sleep(1000);

    // Click Edit
    const editClicked = await page.evaluate((rid) => {
      const row = document.getElementById(rid);
      if (!row) return false;
      const byClass = row.querySelector('a.edit-folder, a.action-edit, a[href*="/edit"]');
      if (byClass) { byClass.click(); return true; }
      const links = row.querySelectorAll('.action-links a, .operations a, a');
      for (const a of links) {
        const text = a.textContent.trim().toLowerCase();
        if (text === 'edit' || text === 'edit folder') {
          a.click();
          return true;
        }
      }
      return false;
    }, rowId);

    if (!editClicked) {
      console.log(`    Could not find Edit option for folder ${folderId}`);
      return false;
    }
    await sleep(2000);

    // Fill new name
    const titleField = await page.$('#edit-title');
    if (titleField) {
      await titleField.click({ clickCount: 3 });
      await titleField.fill(newName);
    }
    await sleep(300);

    // Submit
    await submitPopup(page);
    console.log(`    Renamed folder ${folderId} to "${newName}"`);
    return true;
  } catch (e) {
    console.log(`    Failed to rename folder ${folderId}: ${e.message}`);
    return false;
  }
}

// ── Audit Functions ──────────────────────────────────────────────────────────

/**
 * Audit a single course: scan work-ahead/future for duplicate day folders
 * and misnamed week folders, and scan root for orphan links.
 */
async function auditCourse(page, course) {
  const result = {
    duplicateDays: [],    // { weekFolderId, weekName, dayName, duplicateIds: [id, id, ...], keepId }
    misnamedWeeks: [],    // { folderId, currentName, suggestedName }
    orphanLinks: [],      // { id, name, type }
  };

  // Step 1: Navigate to work-ahead/future
  console.log(`  Scanning work-ahead/future...`);
  await navigateToFolder(page, course.id);
  const topItems = await listItems(page);

  const workAhead = topItems.find(i => i.type === 'folder' && i.name === 'work-ahead/future');
  if (!workAhead) {
    console.log(`  No "work-ahead/future" folder found — skipping week/day audit.`);
  } else {
    await navigateToFolder(page, course.id, workAhead.id);
    const weekFolders = await listItems(page);
    const folders = weekFolders.filter(i => i.type === 'folder');

    console.log(`  Found ${folders.length} week folder(s) in work-ahead/future`);

    // Step 2: Check for misnamed weeks
    for (const wf of folders) {
      if (!/^Week \d+$/.test(wf.name)) {
        let suggestedName = null;
        // Try to fix casing: "week 25" → "Week 25"
        const lowerMatch = wf.name.match(/^week\s+(\d+)$/i);
        if (lowerMatch) {
          suggestedName = `Week ${lowerMatch[1]}`;
        }
        result.misnamedWeeks.push({
          folderId: wf.id,
          currentName: wf.name,
          suggestedName,
          parentFolderId: workAhead.id,
        });
        console.log(`    Misnamed week: "${wf.name}" → ${suggestedName || '(needs manual review)'}`);
      }
    }

    // Step 3: Check each week folder for duplicate day folders
    for (const wf of folders) {
      await navigateToFolder(page, course.id, wf.id);
      const dayItems = await listItems(page);
      const dayFolders = dayItems.filter(i => i.type === 'folder');

      // Group by name
      const byName = {};
      for (const df of dayFolders) {
        if (!byName[df.name]) byName[df.name] = [];
        byName[df.name].push(df);
      }

      for (const [dayName, copies] of Object.entries(byName)) {
        if (copies.length > 1) {
          // Keep the first (oldest, appears first in DOM) — Schoology lists in creation order
          const keepId = copies[0].id;
          const duplicateIds = copies.slice(1).map(c => c.id);
          result.duplicateDays.push({
            weekFolderId: wf.id,
            weekName: wf.name,
            dayName,
            keepId,
            duplicateIds,
          });
          console.log(`    Duplicate day: "${dayName}" in ${wf.name} — ${copies.length} copies (keeping ${keepId}, removing ${duplicateIds.join(', ')})`);
        }
      }
    }
  }

  // Step 4: Scan root for orphan topic/quiz links
  console.log(`  Scanning root for orphan links...`);
  await navigateToFolder(page, course.id);
  const rootItems = await listItems(page);

  const orphanPatterns = [
    /^Topic \d+\.\d+/,
    /^Quiz \d+\.\d+/,
    /\d+\.\d+ —/,
    /^AP Classroom Video/,
  ];

  for (const item of rootItems) {
    if (item.type === 'link' && orphanPatterns.some(p => p.test(item.name))) {
      result.orphanLinks.push({
        id: item.id,
        name: item.name,
        type: item.type,
      });
      console.log(`    Orphan link: "${item.name}" (id: ${item.id})`);
    }
  }

  return result;
}

// ── Fix Functions ────────────────────────────────────────────────────────────

async function fixDuplicateDays(page, course, duplicateDays) {
  let attempted = 0, succeeded = 0;
  for (const dup of duplicateDays) {
    console.log(`\n  Fixing duplicate day: "${dup.dayName}" in ${dup.weekName}`);

    for (const dupId of dup.duplicateIds) {
      attempted++;
      // Move contents from duplicate into the keeper (by ID, not name — avoids ambiguity)
      console.log(`    Moving contents from duplicate ${dupId} into ${dup.keepId}...`);
      const moved = await moveItemsToFolder(page, course.id, dupId, dup.keepId);
      console.log(`    Moved ${moved} item(s)`);

      // Verify the duplicate is now empty
      await navigateToFolder(page, course.id, dupId);
      const remaining = await listItems(page);

      if (remaining.length === 0) {
        // Navigate to week folder where the duplicate is listed
        await navigateToFolder(page, course.id, dup.weekFolderId);
        console.log(`    Deleting empty duplicate folder ${dupId}...`);
        const deleted = await deleteItem(page, `f-${dupId}`);
        console.log(`    ${deleted ? 'Deleted' : 'Failed to delete'} duplicate folder ${dupId}`);
        if (deleted) succeeded++;
      } else {
        console.log(`    WARNING: Duplicate folder ${dupId} still has ${remaining.length} item(s) — not deleting`);
      }
    }
  }
  return { attempted, succeeded };
}

async function fixMisnamedWeeks(page, course, misnamedWeeks) {
  let attempted = 0, succeeded = 0;
  for (const mis of misnamedWeeks) {
    if (!mis.suggestedName) {
      // Check if it's empty — if so, delete; otherwise skip
      await navigateToFolder(page, course.id, mis.folderId);
      const contents = await listItems(page);
      if (contents.length === 0) {
        attempted++;
        console.log(`\n  Deleting empty misnamed folder: "${mis.currentName}"`);
        await navigateToFolder(page, course.id, mis.parentFolderId);
        const deleted = await deleteItem(page, `f-${mis.folderId}`);
        console.log(`  ${deleted ? 'Deleted' : 'Failed to delete'} empty folder "${mis.currentName}"`);
        if (deleted) succeeded++;
      } else {
        console.log(`\n  SKIPPING misnamed folder "${mis.currentName}" — has ${contents.length} item(s) and no auto-fix name`);
      }
      continue;
    }

    attempted++;
    console.log(`\n  Renaming "${mis.currentName}" → "${mis.suggestedName}"`);
    // Navigate to the parent so the folder row #f-{folderId} is visible
    await navigateToFolder(page, course.id, mis.parentFolderId);
    const renamed = await renameFolder(page, mis.folderId, mis.suggestedName);
    if (renamed) {
      succeeded++;
    } else {
      console.log(`  Failed to rename "${mis.currentName}"`);
    }
  }
  return { attempted, succeeded };
}

async function fixOrphanLinks(page, course, orphanLinks) {
  let attempted = 0, succeeded = 0;
  for (const orphan of orphanLinks) {
    attempted++;
    console.log(`\n  Handling orphan: "${orphan.name}" (${orphan.id})`);

    // Delete orphans — they were posted to root by mistake.
    // The poster will re-create them in the correct folder on next run.
    await navigateToFolder(page, course.id);
    const deleted = await deleteItem(page, `n-${orphan.id}`);
    console.log(`  ${deleted ? 'Deleted' : 'Failed to delete'} orphan "${orphan.name}"`);
    if (deleted) succeeded++;
  }
  return { attempted, succeeded };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Schoology Folder Audit${execute ? ' + Fix' : ' (dry-run)'}`);
  console.log(`Periods: ${COURSES.map(c => c.period).join(', ')}\n`);

  console.log('Connecting to browser via CDP...');
  const { browser, page } = await connectCDP(chromium, { preferUrl: 'schoology.com' });

  let totalIssues = 0;

  for (const course of COURSES) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`  Period ${course.period} (course ${course.id})`);
    console.log("=".repeat(50));

    const result = await auditCourse(page, course);

    const issueCount = result.duplicateDays.length +
                       result.misnamedWeeks.length +
                       result.orphanLinks.length;
    totalIssues += issueCount;

    auditLog.courses[course.period] = {
      courseId: course.id,
      issues: issueCount,
      duplicateDays: result.duplicateDays,
      misnamedWeeks: result.misnamedWeeks,
      orphanLinks: result.orphanLinks,
      fixed: false,
    };

    console.log(`\n  Summary: ${result.duplicateDays.length} duplicate day(s), ` +
                `${result.misnamedWeeks.length} misnamed week(s), ` +
                `${result.orphanLinks.length} orphan link(s)`);

    if (execute && issueCount > 0) {
      console.log(`\n  Applying fixes...`);
      let totalAttempted = 0, totalSucceeded = 0;

      // Order matters: merge duplicates first, then rename, then handle orphans
      if (result.duplicateDays.length > 0) {
        const r = await fixDuplicateDays(page, course, result.duplicateDays);
        totalAttempted += r.attempted; totalSucceeded += r.succeeded;
      }
      if (result.misnamedWeeks.length > 0) {
        const r = await fixMisnamedWeeks(page, course, result.misnamedWeeks);
        totalAttempted += r.attempted; totalSucceeded += r.succeeded;
      }
      if (result.orphanLinks.length > 0) {
        const r = await fixOrphanLinks(page, course, result.orphanLinks);
        totalAttempted += r.attempted; totalSucceeded += r.succeeded;
      }

      const allFixed = totalAttempted > 0 && totalSucceeded === totalAttempted;
      auditLog.courses[course.period].fixed = allFixed;
      auditLog.courses[course.period].fixResults = { attempted: totalAttempted, succeeded: totalSucceeded };
      console.log(`\n  Fix results: ${totalSucceeded}/${totalAttempted} succeeded${allFixed ? '' : ' (PARTIAL)'}`);
    }
  }

  // Write log
  writeFileSync(LOG_PATH, JSON.stringify(auditLog, null, 2));
  console.log(`\nLog written to: ${LOG_PATH}`);

  console.log(`\nTotal issues found: ${totalIssues}`);
  if (totalIssues > 0 && !execute) {
    console.log(`Run with --execute to fix these issues.`);
  }

  console.log('\nDone. Disconnecting.');
  if (browser) await browser.close();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
