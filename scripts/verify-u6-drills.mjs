#!/usr/bin/env node
/**
 * verify-u6-drills.mjs — Verify and repair Unit 6 drill links in Schoology.
 *
 * Phases:
 *   1. Registry audit (offline)
 *   2. CDP verification (live Schoology check)
 *   3. Repair (post missing, replace wrong, deduplicate) — only with --fix
 *   4. Summary report
 *
 * Usage:
 *   node scripts/verify-u6-drills.mjs              # dry-run (default)
 *   node scripts/verify-u6-drills.mjs --fix         # apply repairs
 *   node scripts/verify-u6-drills.mjs --period E    # one period only
 *   node scripts/verify-u6-drills.mjs --lesson 3    # one lesson only
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { getLesson, getSchoologyState, updateSchoologyMaterial, updateStatus, updateUrl, loadRegistry } from './lib/lesson-registry.mjs';
import { getCorrectDrillUrl, isDrillTitle, drillTitle } from './lib/drill-url-table.mjs';
import { printRegistryAudit, printVerificationReport, printSummary } from './lib/drill-verify-report.mjs';
import { resolveFolderPath } from './lib/resolve-folder-path.mjs';

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let fix = false;
  let period = null;   // null = both
  let lesson = null;   // null = all 11
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--fix') fix = true;
    else if (a === '--dry-run') fix = false;
    else if (a === '--period') period = args[++i]?.toUpperCase();
    else if (a === '--lesson') lesson = parseInt(args[++i], 10);
    else if (a === '--verbose' || a === '-v') verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/verify-u6-drills.mjs [options]\n\n' +
        '  --dry-run       Read-only audit (default)\n' +
        '  --fix           Post missing, replace wrong, deduplicate\n' +
        '  --period <B|E>  One period only (default: both)\n' +
        '  --lesson <N>    One lesson only (default: 6.1-6.11)\n' +
        '  --verbose       Per-link detail\n'
      );
      process.exit(0);
    }
  }

  return { fix, period, lesson, verbose };
}

// ── Constants ────────────────────────────────────────────────────────────────

const COURSE_IDS = { B: '7945275782', E: '7945275798' };
const ALL_LESSONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// ── URL Normalization ────────────────────────────────────────────────────────

/**
 * Schoology wraps external links through a redirect like:
 *   https://lynnschools.schoology.com/extlink/...?path=<encoded-url>&...
 * Extract the real target URL from either the raw URL or a Schoology redirect.
 */
function unwrapSchoologyUrl(rawUrl) {
  if (!rawUrl) return null;
  let url = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    // If it's a Schoology redirect, pull the `path` query param
    if (parsed.hostname.includes('schoology.com') && parsed.searchParams.has('path')) {
      url = decodeURIComponent(parsed.searchParams.get('path'));
    }
  } catch { /* not a valid URL — fall through */ }
  // Schoology double-encodes ampersands as &amp; — decode them
  url = url.replace(/&amp;/g, '&');
  return url;
}

// ── Phase 1: Registry Audit ──────────────────────────────────────────────────

function registryAudit(lessons, periods) {
  const results = [];

  for (const n of lessons) {
    const entry = getLesson(6, n);
    const correctUrl = getCorrectDrillUrl(n);
    const urlCorrect = entry?.urls?.drills === correctUrl;

    const periodResults = {};
    for (const p of periods) {
      const sState = getSchoologyState(6, n, p);
      if (!sState || !sState.folderId) {
        periodResults[p] = { status: 'no-folder' };
      } else if (!sState.materials?.drills) {
        periodResults[p] = { status: 'missing' };
      } else if (!sState.materials.drills.schoologyId && !sState.materials.drills.verified) {
        periodResults[p] = { status: 'unverified' };
      } else if (sState.materials.drills.targetUrl && sState.materials.drills.targetUrl !== correctUrl) {
        periodResults[p] = { status: 'wrong-url' };
      } else {
        periodResults[p] = { status: 'ok' };
      }
    }

    // Ensure both periods present for report (fill missing period with 'skipped')
    for (const p of ['B', 'E']) {
      if (!periodResults[p]) periodResults[p] = { status: 'skipped' };
    }

    results.push({ lesson: n, urlCorrect, periods: periodResults });
  }

  return results;
}

// ── Phase 2: CDP Verification ────────────────────────────────────────────────

async function cdpVerify(page, lessons, periods, verbose, fix) {
  const { navigateToFolder, navigatePath, listItems, sleep } = await import('./lib/schoology-dom.mjs');
  const results = [];
  // Track discovered folderIds in-memory so Phase 3 can use them without
  // requiring a registry write during dry-run
  const discoveredFolders = {};  // key: `${n}-${p}` → folderId

  for (const n of lessons) {
    const periodResults = {};

    for (const p of periods) {
      const sState = getSchoologyState(6, n, p);
      const courseId = COURSE_IDS[p];

      // Resolve folderId: from registry, or via folder path fallback
      let folderId = sState?.folderId || null;
      if (!folderId) {
        try {
          const fpInfo = resolveFolderPath(6, n, { period: p });
          console.log(`  [6.${n} ${p}] Discovering folder: ${fpInfo.folderPath.join(' > ')}`);
          folderId = await navigatePath(page, courseId, fpInfo.folderPath, { createMissing: false });
          discoveredFolders[`${n}-${p}`] = folderId;
          console.log(`  [6.${n} ${p}] Found folder: ${folderId}`);
        } catch {
          if (verbose) console.log(`  [6.${n} ${p}] No folder found — skipping`);
          periodResults[p] = { status: 'skipped' };
          continue;
        }
      }

      // Navigate to the folder and list items
      console.log(`  [6.${n} ${p}] Checking folder ${folderId}...`);
      await navigateToFolder(page, courseId, folderId);
      const items = await listItems(page);

      // Find drill link by title
      const drillItems = items.filter(i => i.type === 'link' && isDrillTitle(i.name, n));

      if (drillItems.length === 0) {
        if (verbose) console.log(`    No drill link found`);
        periodResults[p] = { status: 'missing' };
        continue;
      }

      // Extract the Schoology material ID from the link href
      // href looks like: https://lynnschools.schoology.com/course/.../materials/link/view/8284383200
      const drillItem = drillItems[0];
      const idMatch = drillItem.href?.match(/\/link\/view\/(\d+)/);
      const materialId = idMatch ? idMatch[1] : null;

      if (verbose) console.log(`    Found: "${drillItem.name}" (id: ${materialId})`);

      // Navigate to link detail page to extract target URL
      let targetUrl = null;
      if (materialId) {
        const detailUrl = `https://lynnschools.schoology.com/course/${courseId}/materials/link/view/${materialId}`;
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);

        targetUrl = await page.evaluate(() => {
          // Schoology wraps external links — look for the actual URL
          const linkEl = document.querySelector('a.link-url') ||
                         document.querySelector('.attachments-file-name a') ||
                         document.querySelector('.link-url-value a') ||
                         document.querySelector('.link-main a[href^="http"]');
          if (linkEl) return linkEl.href;

          // Fallback: look for any lrsl-driller link on the page
          for (const a of document.querySelectorAll('a[href]')) {
            if (a.href.includes('lrsl-driller')) return a.href;
          }
          return null;
        });

        if (verbose) console.log(`    Raw URL: ${targetUrl || '(not found)'}`);

        // Unwrap Schoology redirect to get the real target
        targetUrl = unwrapSchoologyUrl(targetUrl);
        if (verbose) console.log(`    Unwrapped URL: ${targetUrl || '(not found)'}`);
      }

      const correctUrl = getCorrectDrillUrl(n);
      const matches = targetUrl === correctUrl;

      periodResults[p] = {
        status: matches ? 'match' : (targetUrl ? 'mismatch' : 'missing'),
        targetUrl,
        materialId,
        title: drillItem.name,
        duplicateIds: drillItems.length > 1 ? drillItems.map(d => {
          const m = d.href?.match(/\/link\/view\/(\d+)/);
          return m ? m[1] : null;
        }).filter(Boolean) : null,
      };

      if (verbose && !matches && targetUrl) {
        console.log(`    MISMATCH: expected ${correctUrl}`);
        console.log(`              got      ${targetUrl}`);
      }
      if (drillItems.length > 1) {
        console.log(`    DUPLICATE: ${drillItems.length} drill links found for 6.${n} in ${p}`);
      }
    }

    // Fill missing periods for report
    for (const p of ['B', 'E']) {
      if (!periodResults[p]) periodResults[p] = { status: 'skipped' };
    }

    results.push({ lesson: n, periods: periodResults });
  }

  return { results, discoveredFolders };
}

// ── Phase 3: Repair ──────────────────────────────────────────────────────────

async function repair(page, verifyResults, periods, verbose, discoveredFolders) {
  const { navigateToFolder, listItems, clickAddMaterials, clickAddFileLink,
          clickLinkOption, fillLinkForm, submitPopup, sleep } = await import('./lib/schoology-dom.mjs');
  const { deleteSchoologyLink } = await import('./lib/schoology-heal.mjs');
  const { setSchoologyState } = await import('./lib/lesson-registry.mjs');

  const summaryResults = [];
  let fixCount = 0;
  const lessonSuccess = new Map();   // Fix 4: per-lesson success tracking

  for (const vr of verifyResults) {
    const n = vr.lesson;
    const correctUrl = getCorrectDrillUrl(n);
    const title = drillTitle(n);
    let periodB = 'skipped';
    let periodE = 'skipped';
    const actions = [];
    let lessonOk = true;

    for (const p of periods) {
      const pr = vr.periods[p];
      if (!pr || pr.status === 'skipped') {
        if (p === 'B') periodB = 'skipped';
        else periodE = 'skipped';
        continue;
      }

      const courseId = COURSE_IDS[p];
      const sState = getSchoologyState(6, n, p);
      let folderId = sState?.folderId || discoveredFolders[`${n}-${p}`] || null;

      if (!folderId) {
        if (p === 'B') periodB = 'no-folder';
        else periodE = 'no-folder';
        continue;
      }

      // Persist discovered folderId to registry now (we're in --fix mode)
      if (!sState?.folderId && discoveredFolders[`${n}-${p}`]) {
        try {
          const fpInfo = resolveFolderPath(6, n, { period: p });
          setSchoologyState(6, n, {
            folderId,
            folderPath: fpInfo.folderPath,
            folderTitle: fpInfo.dayTitle,
            verifiedAt: null,
            reconciledAt: null,
            materials: sState?.materials || {},
          }, p);
          console.log(`  [6.${n} ${p}] Saved discovered folderId ${folderId} to registry`);
        } catch (e) {
          console.log(`  [6.${n} ${p}] WARNING: Could not persist folderId: ${e.message}`);
        }
      }

      if (pr.status === 'match') {
        if (p === 'B') periodB = 'ok';
        else periodE = 'ok';
        updateSchoologyMaterial(6, n, 'drills', {
          schoologyId: pr.materialId || null,
          title: pr.title || title,
          targetUrl: correctUrl,
          verified: true,
          status: 'done',
        }, p);
        continue;
      }

      if (pr.status === 'mismatch') {
        console.log(`  [FIX 6.${n} ${p}] Replacing wrong-URL drill link...`);

        // Step 1: Try to delete old link
        let deleteOk = true;
        if (pr.materialId) {
          await navigateToFolder(page, courseId, folderId);
          const delResult = await deleteSchoologyLink(page, pr.materialId);
          if (delResult.deleted) {
            console.log(`    Deleted old link (${pr.materialId})`);
          } else {
            console.log(`    FAILED to delete old link: ${delResult.reason}`);
            deleteOk = false;
          }
          await sleep(2000);
        }

        // Step 2: Snapshot existing IDs, then post correct link
        // (Post even if delete failed — the correct link alongside the
        //  old one is better than only the wrong one.)
        const matUrl = `https://lynnschools.schoology.com/course/${courseId}/materials?f=${folderId}`;
        await page.goto(matUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const preIds = await snapshotDrillIds(page, n);
        await postDrillLink(page, title, correctUrl, courseId, folderId);
        await sleep(1000);

        // Step 3: Re-navigate to folder (page.goto to avoid SPA cache) and capture new ID
        await page.goto(matUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const newId = await captureNewLinkId(page, title, preIds);

        // Fix 1+3: only mark verified if we got the new ID AND delete succeeded
        const fullyDone = !!newId && deleteOk;
        updateSchoologyMaterial(6, n, 'drills', {
          schoologyId: newId,
          title,
          href: newId ? `https://lynnschools.schoology.com/course/${courseId}/materials/link/view/${newId}` : null,
          targetUrl: correctUrl,
          verified: fullyDone,
          status: fullyDone ? 'done' : (deleteOk ? 'posted-unverified' : 'partial-old-remains'),
          postedAt: new Date().toISOString(),
          ...(pr.materialId && !deleteOk ? { previousId: pr.materialId } : {}),
        }, p);

        if (!newId) console.log(`    WARNING: Posted but could not capture new link ID`);
        if (!fullyDone) lessonOk = false;

        const label = deleteOk ? 'replaced' : 'replaced-partial';
        if (p === 'B') periodB = label;
        else periodE = label;
        actions.push(`${label} ${p}`);
        fixCount++;
        continue;
      }

      if (pr.status === 'missing') {
        console.log(`  [FIX 6.${n} ${p}] Posting missing drill link...`);

        // Snapshot existing IDs, then post
        const matUrl = `https://lynnschools.schoology.com/course/${courseId}/materials?f=${folderId}`;
        await page.goto(matUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const preIds = await snapshotDrillIds(page, n);
        await postDrillLink(page, title, correctUrl, courseId, folderId);
        await sleep(1000);

        // Re-navigate to folder (page.goto to avoid SPA cache) and capture new ID
        await page.goto(matUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const newId = await captureNewLinkId(page, title, preIds);

        // Fix 1: only mark verified if we captured the new ID
        updateSchoologyMaterial(6, n, 'drills', {
          schoologyId: newId,
          title,
          href: newId ? `https://lynnschools.schoology.com/course/${courseId}/materials/link/view/${newId}` : null,
          targetUrl: correctUrl,
          verified: !!newId,
          status: newId ? 'done' : 'posted-unverified',
          postedAt: new Date().toISOString(),
        }, p);

        if (!newId) {
          console.log(`    WARNING: Posted but could not capture new link ID`);
          lessonOk = false;
        }

        if (p === 'B') periodB = 'posted';
        else periodE = 'posted';
        actions.push(`posted ${p}`);
        fixCount++;
        continue;
      }
    }

    // ── Fix 5: Dedupe with survivor selection ──
    for (const p of periods) {
      const pr = vr.periods[p];
      if (!pr?.duplicateIds || pr.duplicateIds.length <= 1) continue;

      const courseId = COURSE_IDS[p];
      const sState = getSchoologyState(6, n, p);
      const folderId = sState?.folderId || discoveredFolders[`${n}-${p}`] || null;
      if (!folderId) continue;

      console.log(`  [FIX 6.${n} ${p}] Deduplicating ${pr.duplicateIds.length} drill links...`);

      // Inspect each duplicate's target URL to pick the best survivor
      const dupInfo = [];
      for (const dupId of pr.duplicateIds) {
        const detailUrl = `https://lynnschools.schoology.com/course/${courseId}/materials/link/view/${dupId}`;
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);

        let targetUrl = await page.evaluate(() => {
          const linkEl = document.querySelector('a.link-url') ||
                         document.querySelector('.attachments-file-name a') ||
                         document.querySelector('.link-url-value a') ||
                         document.querySelector('.link-main a[href^="http"]');
          if (linkEl) return linkEl.href;
          for (const a of document.querySelectorAll('a[href]')) {
            if (a.href.includes('lrsl-driller')) return a.href;
          }
          return null;
        });
        targetUrl = unwrapSchoologyUrl(targetUrl);
        dupInfo.push({ id: dupId, targetUrl, matches: targetUrl === correctUrl });
      }

      // Survivor rule: prefer correct URL, then lowest ID (oldest)
      const correctOnes = dupInfo.filter(d => d.matches);
      const survivor = correctOnes.length > 0
        ? correctOnes.reduce((a, b) => (a.id < b.id ? a : b))
        : dupInfo.reduce((a, b) => (a.id < b.id ? a : b));

      console.log(`    Keeping survivor: ${survivor.id} (${survivor.matches ? 'correct URL' : 'oldest'})`);

      // Delete all non-survivors
      let allDeletesOk = true;
      for (const d of dupInfo) {
        if (d.id === survivor.id) continue;
        await navigateToFolder(page, courseId, folderId);
        const delResult = await deleteSchoologyLink(page, d.id);
        if (delResult.deleted) {
          console.log(`    Deleted duplicate (${d.id})`);
        } else {
          console.log(`    FAILED to delete duplicate (${d.id}): ${delResult.reason}`);
          allDeletesOk = false;
        }
        await sleep(2000);
      }

      // Fix 3: Only count as fixed if all deletes succeeded
      if (allDeletesOk) {
        if (p === 'B') periodB = 'deduped';
        else periodE = 'deduped';
        actions.push(`deduped ${p}`);
        fixCount++;
      } else {
        if (p === 'B') periodB = 'partial-dedup';
        else periodE = 'partial-dedup';
        actions.push(`partial-dedup ${p}`);
        lessonOk = false;
      }

      // Update registry with survivor info
      updateSchoologyMaterial(6, n, 'drills', {
        schoologyId: survivor.id,
        title: pr.title || title,
        href: `https://lynnschools.schoology.com/course/${courseId}/materials/link/view/${survivor.id}`,
        targetUrl: survivor.targetUrl || correctUrl,
        verified: survivor.matches && allDeletesOk,
        status: allDeletesOk ? 'done' : 'partial-dedup',
      }, p);
    }

    // Fix 4: per-lesson success
    lessonSuccess.set(n, lessonOk);

    let action = 'none';
    if (actions.length > 0) {
      action = `fix: ${actions.join(', ')}`;
    }

    summaryResults.push({ lesson: n, periodB, periodE, action });
  }

  return { summaryResults, fixCount, lessonSuccess };
}

// ── Post a drill link ────────────────────────────────────────────────────────

/**
 * Post a drill link by navigating directly to Schoology's link creation form.
 * Bypasses the popup flow entirely (Schoology's popup JS handlers don't fire
 * reliably via CDP). The form URL pattern is:
 *   /course/{courseId}/materials/documents/add/link?f={folderId}
 */
async function postDrillLink(page, title, url, courseId, folderId) {
  const formUrl = `https://lynnschools.schoology.com/course/${courseId}/materials/documents/add/link?f=${folderId}`;
  await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const urlField = await page.$('#edit-link');
  if (!urlField) throw new Error('Could not find URL field (#edit-link) on form page');
  await urlField.click({ clickCount: 3 });
  await urlField.fill(url);

  const titleField = await page.$('#edit-link-title');
  if (!titleField) throw new Error('Could not find title field (#edit-link-title)');
  await titleField.fill(title);

  await page.click('#edit-submit');
  await page.waitForTimeout(3000);
  console.log(`    Posted: "${title}"`);
}

/**
 * Snapshot existing drill link IDs in the current folder page before posting.
 * Uses the same broad selector as captureNewLinkId for consistency.
 */
async function snapshotDrillIds(page, lessonNum) {
  try {
    const allLinks = await page.evaluate(() => {
      const results = [];
      const rows = document.querySelectorAll(
        '#folder-contents-table > tbody > tr, tr.material-row, .material-row'
      );
      for (const r of rows) {
        const a = r.querySelector('.item-title a, td a[href*="/link/view/"]');
        if (!a) continue;
        const href = a.href || a.getAttribute('href') || '';
        if (!href.includes('/link/view/')) continue;
        results.push({ name: (a.textContent || '').trim(), href });
      }
      return results;
    });
    return allLinks
      .filter(i => isDrillTitle(i.name, lessonNum))
      .map(i => { const m = i.href.match(/\/link\/view\/(\d+)/); return m?.[1]; })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * After posting a link, diff the current folder against a pre-existing ID
 * snapshot to find the newly created link's Schoology material ID.
 *
 * Uses a broader selector than listItems() — Schoology renders material rows
 * with both n- and s- prefixes, and listItems only checks n-.
 */
async function captureNewLinkId(page, title, preExistingIds = []) {
  const { sleep } = await import('./lib/schoology-dom.mjs');
  await sleep(1000); // extra wait for DOM to settle after navigation
  try {
    const allLinks = await page.evaluate(() => {
      const results = [];
      // Broad: any row inside the folder contents table, plus material-row class
      const rows = document.querySelectorAll(
        '#folder-contents-table > tbody > tr, tr.material-row, .material-row'
      );
      for (const r of rows) {
        const a = r.querySelector('.item-title a, td a[href*="/link/view/"]');
        if (!a) continue;
        const href = a.href || a.getAttribute('href') || '';
        if (!href.includes('/link/view/')) continue;
        results.push({ name: (a.textContent || '').trim(), href });
      }
      return results;
    });

    const titleLower = title.toLowerCase().trim();
    for (const item of allLinks) {
      if (item.name.toLowerCase().trim() !== titleLower) continue;
      const idMatch = item.href.match(/\/link\/view\/(\d+)/);
      const id = idMatch ? idMatch[1] : null;
      if (id && !preExistingIds.includes(id)) return id;
    }
    // Debug: log what we found vs what we expected
    const foundTitles = allLinks.map(l => l.name).join(', ');
    console.log(`    [capture] Found ${allLinks.length} links on page: [${foundTitles}]`);
    console.log(`    [capture] Looking for: "${title}", pre-existing IDs: [${preExistingIds.join(', ')}]`);
  } catch (e) {
    console.log(`    [capture] Error: ${e.message}`);
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const lessons = opts.lesson ? [opts.lesson] : ALL_LESSONS;
  const periods = opts.period ? [opts.period] : ['B', 'E'];

  console.log(`\nUnit 6 Drill Link Verification`);
  console.log(`Mode: ${opts.fix ? '--fix (will apply changes)' : '--dry-run (read-only)'}`);
  console.log(`Periods: ${periods.join(', ')}  |  Lessons: ${lessons.map(n => '6.' + n).join(', ')}`);

  // ── Phase 1: Registry Audit ──
  console.log('\n--- Phase 1: Registry Audit ---');
  const auditResults = registryAudit(lessons, periods);
  printRegistryAudit(auditResults);

  // Fix registry urls.drills if wrong
  for (const r of auditResults) {
    if (!r.urlCorrect) {
      const correctUrl = getCorrectDrillUrl(r.lesson);
      if (correctUrl) {
        if (opts.fix) {
          console.log(`  [FIX] Correcting urls.drills for 6.${r.lesson}`);
          updateUrl(6, r.lesson, 'drills', correctUrl);
        } else {
          console.log(`  [DRY-RUN] Would correct urls.drills for 6.${r.lesson}`);
        }
      }
    }
  }

  // ── Phase 2: CDP Verification ──
  console.log('\n--- Phase 2: CDP Verification ---');
  let chromium;
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch {
    console.error('Error: playwright not installed. Run: npm install playwright');
    process.exit(1);
  }

  const { connectCDP } = await import('./lib/cdp-connect.mjs');
  const { browser, page } = await connectCDP(chromium, { preferUrl: 'schoology.com' });

  try {
    const verifyOutput = await cdpVerify(page, lessons, periods, opts.verbose, opts.fix);
    const verifyResults = verifyOutput.results;
    const discoveredFolders = verifyOutput.discoveredFolders;
    printVerificationReport(verifyResults);

    // ── Phase 3: Repair ──
    let summaryResults;
    let fixCount = 0;

    let lessonSuccess = new Map();

    if (opts.fix) {
      console.log('\n--- Phase 3: Repair ---');
      const repairResult = await repair(page, verifyResults, periods, opts.verbose, discoveredFolders);
      summaryResults = repairResult.summaryResults;
      fixCount = repairResult.fixCount;
      lessonSuccess = repairResult.lessonSuccess;
    } else {
      // Build dry-run summary from verify results
      summaryResults = [];
      fixCount = 0;
      for (const vr of verifyResults) {
        let periodB = 'skipped', periodE = 'skipped';
        let action = 'none';
        const needed = [];

        for (const p of ['B', 'E']) {
          const pr = vr.periods[p];
          const status = pr?.status || 'skipped';
          if (p === 'B') periodB = status;
          else periodE = status;

          if (status === 'missing' || status === 'mismatch') {
            needed.push(`${status} ${p}`);
            fixCount++;
          }
          if (pr?.duplicateIds && pr.duplicateIds.length > 1) {
            needed.push(`dedup ${p}`);
            fixCount++;
          }
        }

        if (needed.length > 0) {
          action = `would: ${needed.join(', ')}`;
        }
        summaryResults.push({ lesson: vr.lesson, periodB, periodE, action });
      }
    }

    // ── Phase 4: Summary ──
    printSummary(summaryResults, { dryRun: !opts.fix, fixCount });

    // Fix 4: Only mark lessons as verified if ALL their period actions succeeded
    if (opts.fix) {
      for (const n of lessons) {
        if (lessonSuccess.get(n)) {
          updateStatus(6, n, 'schoologyVerified', 'done');
        } else if (lessonSuccess.has(n)) {
          console.log(`  [6.${n}] NOT marking schoologyVerified — partial failures remain`);
        }
      }
    }

  } finally {
    console.log('\nDisconnecting CDP (browser stays open).');
    if (browser) await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
