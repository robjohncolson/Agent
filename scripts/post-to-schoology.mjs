#!/usr/bin/env node
/**
 * post-to-schoology.mjs — Post lesson material links to Schoology via Playwright CDP.
 *
 * Connects to an already-running browser via Chrome DevTools Protocol (CDP) so the
 * user's Schoology session is available.
 *
 * Usage:
 *   # Post all 4 lesson links explicitly
 *   node scripts/post-to-schoology.mjs --unit 6 --lesson 5 \
 *     --worksheet "https://robjohncolson.github.io/apstats-live-worksheet/u6_lesson5_live.html" \
 *     --drills "https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l24-test-statistic" \
 *     --quiz "https://robjohncolson.github.io/curriculum_render/?u=6&l=4" \
 *     --blooket "https://dashboard.blooket.com/set/xxx"
 *
 *   # Auto-generate URLs and prompt for blooket
 *   node scripts/post-to-schoology.mjs --unit 6 --lesson 5 --auto-urls
 *
 *   # Dry run — show what would be posted
 *   node scripts/post-to-schoology.mjs --unit 6 --lesson 5 --auto-urls --dry-run
 *
 * Start Edge with remote debugging first:
 *   scripts/start-edge-debug.cmd
 *
 * Prerequisites:
 *   npm install playwright
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { connectCDP } from "./lib/cdp-connect.mjs";
import { WORKSHEET_REPO, SCRIPTS } from "./lib/paths.mjs";
import { buildLinkTitles, computeUrls, resolveDrillsLink } from "./lib/course-metadata.mjs";
import { getLesson, updateStatus, updateUrl, updateSchoologyLink, updateSchoologyMaterial, setSchoologyState } from "./lib/lesson-registry.mjs";
import { auditSchoologyFolder, buildExpectedLinks, deleteSchoologyLink, discoverLessonFolder, findOrphanedLinks, verifyPostedLink } from "./lib/schoology-heal.mjs";
import { COURSE_IDS } from './lib/schoology-dom.mjs';
import { resolveFolderPath } from './lib/resolve-folder-path.mjs';
import { upsertTopic, upsertLessonUrls } from './lib/supabase-schedule.mjs';

// Playwright is imported dynamically in main() so that arg parsing and --help
// work even if the package isn't installed yet.
let chromium;

async function syncFolderToSupabase(unit, lesson, period, folderId, materialUrls) {
  try {
    const topicKey = `${unit}.${lesson}`;
    const result = await upsertTopic(topicKey, period, {
      status: 'posted',
      schoologyFolderId: folderId,
    });
    if (result.ok) {
      console.log(`  [supabase] Synced folder ID ${folderId} for ${topicKey} Period ${period}`);
    } else {
      console.warn(`  [supabase] Failed to sync folder ID: ${result.error}`);
    }
    // Sync topic-global material URLs to lesson_urls table (sparse — only non-undefined keys)
    if (materialUrls && Object.keys(materialUrls).length > 0) {
      const urlResult = await upsertLessonUrls(topicKey, materialUrls);
      if (urlResult.ok) {
        console.log(`  [supabase] Synced material URLs for ${topicKey}`);
      } else {
        console.warn(`  [supabase] Failed to sync material URLs: ${urlResult.error}`);
      }
    }
  } catch (err) {
    console.warn(`  [supabase] Failed to sync: ${err.message}`);
  }
}

// ── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://lynnschools.schoology.com";
const DEFAULT_COURSE_ID = "7945275782";

function detectPeriod(courseId) {
  if (courseId === COURSE_IDS.E || courseId === 'E') return 'E';
  return 'B';
}

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let unit = null;
  let lesson = null;
  let worksheetUrl = null;
  let drillsUrl = null;
  let quizUrl = null;
  let blooketUrl = null;
  let autoUrls = false;
  let only = null;
  let courseId = DEFAULT_COURSE_ID;
  let dryRun = false;
  let createFolder = null;
  let folderDesc = null;
  let withVideos = false;
  let noPrompt = false;
  let targetFolder = null;
  let folderPath = null;
  let heal = false;
  let courses = null;
  let skipMissing = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--unit" || arg === "-u") {
      unit = parseInt(args[++i], 10);
    } else if (arg === "--lesson" || arg === "-l") {
      lesson = parseInt(args[++i], 10);
    } else if (arg === "--worksheet") {
      worksheetUrl = args[++i];
    } else if (arg === "--drills") {
      drillsUrl = args[++i];
    } else if (arg === "--quiz") {
      quizUrl = args[++i];
    } else if (arg === "--blooket") {
      blooketUrl = args[++i];
    } else if (arg === "--auto-urls") {
      autoUrls = true;
    } else if (arg === "--only") {
      only = args[++i];
    } else if (arg === "--course") {
      courseId = args[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--create-folder") {
      createFolder = args[++i];
    } else if (arg === "--folder-desc") {
      folderDesc = args[++i].replace(/\\n/g, '\n');
    } else if (arg === "--with-videos") {
      withVideos = true;
    } else if (arg === "--calendar-link" || arg === "--calendar-title") {
      ++i; // skip deprecated arg value
    } else if (arg === "--no-prompt") {
      noPrompt = true;
    } else if (arg === "--target-folder") {
      targetFolder = args[++i];
    } else if (arg === "--folder-path") {
      folderPath = args[++i];
    } else if (arg === "--heal") {
      heal = true;
    } else if (arg === "--courses") {
      courses = args[++i];
    } else if (arg === "--skip-missing") {
      skipMissing = true;
    }
  }

  if (!unit || !lesson) {
    console.error(
      "Usage: node scripts/post-to-schoology.mjs --unit <U> --lesson <L> [options]\n\n" +
        "Options:\n" +
        "  -u, --unit        Unit number (required)\n" +
        "  -l, --lesson      Lesson number (required)\n" +
        "  --worksheet       Worksheet URL\n" +
        "  --drills          Drills URL\n" +
        "  --quiz            Quiz URL\n" +
        "  --blooket         Blooket URL\n" +
        "  --auto-urls       Auto-generate worksheet/drills/quiz URLs, prompt for blooket\n" +
        "  --only            Post only this link type (worksheet, drills, quiz, blooket)\n" +
        "  --course          Course ID (default: 7945275782)\n" +
        "  --dry-run         Show what would be posted without actually posting\n" +
        "  --create-folder   Create a Schoology folder with this title, post links inside it\n" +
        "  --folder-desc     Description text for the folder\n" +
        "  --with-videos     Include AP Classroom video links from curriculum_render/data/units.js\n" +
        "  --no-prompt       Skip interactive prompts (for automated/pipeline use)\n" +
        "  --target-folder   Post into an existing folder URL (skip folder creation)\n" +
        "  --folder-path     Navigate into nested folder hierarchy (e.g. \"Q3/week 24\"), create missing folders\n" +
        "  --heal            Heal mode: audit folder, post only missing links, verify\n" +
        "  --courses         Comma-separated course IDs to post to all (e.g. '7945275782,7945275798')\n" +
        "  --skip-missing    Skip posting worksheet link if local HTML file doesn't exist\n"
    );
    process.exit(1);
  }

  return { unit, lesson, worksheetUrl, drillsUrl, quizUrl, blooketUrl, autoUrls, only, courseId, dryRun, createFolder, folderDesc, withVideos, noPrompt, targetFolder, folderPath, heal, courses, skipMissing };
}

// ── Auto-URL generation ─────────────────────────────────────────────────────

/**
 * Find the first drill mode matching a given unit.lesson from the cartridge manifest.
 */


/*
function legacyBuildAutoUrls(unit, lesson) {
  // Worksheet
  const worksheetUrl =
    `https://robjohncolson.github.io/apstats-live-worksheet/u${unit}_lesson${lesson}_live.html`;

  // Drills
  let drillsUrl = null;
  const { cartridgeId, modeId } = legacyFindFirstDrillMode(unit, lesson);
  if (cartridgeId && modeId) {
    drillsUrl =
      `https://lrsl-driller.vercel.app/platform/app.html?c=${cartridgeId}&level=${modeId}`;
  } else if (cartridgeId) {
    console.warn(`  WARNING: Could not auto-detect drill mode for ${unit}.${lesson}. Cartridge: ${cartridgeId}`);
    drillsUrl =
      `https://lrsl-driller.vercel.app/platform/app.html?c=${cartridgeId}`;
  } else {
    console.warn(`  WARNING: No cartridge mapped for unit ${unit}. Skipping drills.`);
  }

  // Quiz (previous lesson)
  let quizUrl = null;
  if (lesson > 1) {
    quizUrl =
      `https://robjohncolson.github.io/curriculum_render/?u=${unit}&l=${lesson - 1}`;
  } else {
    console.warn("  WARNING: No quiz — lesson 1 has no previous lesson. Skipping quiz.");
  }

  return { worksheetUrl, drillsUrl, quizUrl };
}
*/

// ── Interactive prompt ──────────────────────────────────────────────────────

/**
 * Prompt the user for input via readline.
 */
function promptUser(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Link titles ─────────────────────────────────────────────────────────────

/*
function legacyBuildLinkTitles(unit, lesson) {
  return {
    worksheet: `Topic ${unit}.${lesson} — Follow-Along Worksheet`,
    drills: `Topic ${unit}.${lesson} — Drills`,
    quiz: `Quiz ${unit}.${lesson - 1}`,
    blooket: `Topic ${unit}.${lesson} — Blooket Review`,
  };
}

// ── Video links from units.js (shared module) ──────────────────────────────
*/
import { loadVideoLinks } from "./lib/load-video-links.mjs";

// ── Folder creation ─────────────────────────────────────────────────────────

/**
 * Create a folder on the Schoology materials page.
 * Selectors discovered via probe-schoology-folder.mjs — update if Schoology changes.
 */
async function createFolder(page, title, description, materialsUrl) {
  console.log(`  Creating folder: "${title}"`);

  await page.goto(materialsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Click "Add Materials" dropdown
  console.log(`    Clicking "Add Materials"...`);
  await page.click('span:has-text("Add Materials")');
  await page.waitForTimeout(1000);

  // Click "Add Folder"
  console.log(`    Clicking "Add Folder"...`);
  await page.click('a:has-text("Add Folder")');
  await page.waitForTimeout(3000);

  // Fill title — confirmed selector: #edit-title (input[name="title"])
  console.log(`    Filling title: "${title}"...`);
  const titleField = await page.$('#edit-title');
  if (!titleField) {
    throw new Error(
      'Could not find folder title field (#edit-title). Run: node scripts/probe-schoology-folder.mjs'
    );
  }
  await titleField.click({ clickCount: 3 });
  await titleField.fill(title);

  // Fill description — it's a TinyMCE iframe (#edit-description_ifr)
  if (description) {
    console.log(`    Filling description (TinyMCE iframe)...`);
    const descIframe = await page.$('#edit-description_ifr');
    if (descIframe) {
      const frame = await descIframe.contentFrame();
      if (frame) {
        const body = await frame.$('body');
        if (body) {
          await body.click();
          // Type line by line, pressing Enter for newlines
          const lines = description.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) await page.keyboard.press('Enter');
            await page.keyboard.type(lines[i]);
          }
        } else {
          console.warn(`    WARNING: Could not find body inside TinyMCE iframe.`);
        }
      } else {
        console.warn(`    WARNING: Could not access TinyMCE iframe content frame.`);
      }
    } else {
      console.warn(`    WARNING: Could not find description iframe (#edit-description_ifr). Folder created without description.`);
    }
  }

  // Click Create — confirmed selector: #edit-submit (value="Create")
  console.log(`    Clicking "Create"...`);
  const submitBtn = await page.$('#edit-submit');
  if (!submitBtn) {
    throw new Error(
      'Could not find Create button (#edit-submit). Run: node scripts/probe-schoology-folder.mjs'
    );
  }
  await submitBtn.click();
  await page.waitForTimeout(3000);

  console.log(`  Folder "${title}" created.`);
}

/**
 * Extract the folder ID for a just-created folder from the materials page DOM.
 * Folder rows are `tr[id^="f-"]` with the numeric ID after the prefix.
 * Returns the folder materials URL: materialsUrl + "?f={folderId}"
 */
async function extractFolderUrl(page, folderTitle, materialsUrl) {
  console.log(`  Extracting folder ID for: "${folderTitle}"...`);

  // Reload materials page to see the new folder row
  await page.goto(materialsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Each folder row is a <tr id="f-{numericId}"> containing the folder title
  const folderRows = await page.$$('tr[id^="f-"]');
  for (const row of folderRows) {
    const titleEl = await row.$('div.folder-title');
    if (!titleEl) continue;
    const text = await titleEl.innerText().catch(() => "");
    if (text.trim() === folderTitle) {
      const rowId = await row.getAttribute('id'); // e.g. "f-986313435"
      const folderId = rowId.replace('f-', '');
      // Replace existing ?f= param or append; avoids ?f=parent?f=child
      const baseUrl = materialsUrl.replace(/\?f=\d+$/, '');
      const folderUrl = `${baseUrl}?f=${folderId}`;
      console.log(`  Found folder ID: ${folderId}`);
      console.log(`  Folder URL: ${folderUrl}`);
      return folderUrl;
    }
  }

  throw new Error(
    `Could not find folder "${folderTitle}" in DOM (no matching tr[id^="f-"]). ` +
    `The folder may not have been created successfully.`
  );
}

// ── Post one link to Schoology ──────────────────────────────────────────────

async function postLink(page, url, title, materialsPageUrl) {
  // Navigate to the specified materials page (root or folder)
  console.log(`    Navigating to materials page...`);
  await page.goto(materialsPageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Click "Add Materials"
  console.log(`    Clicking "Add Materials"...`);
  await page.click('span:has-text("Add Materials")');
  await page.waitForTimeout(1000);

  // Click "Add File/Link/External Tool"
  console.log(`    Clicking "Add File/Link/External Tool"...`);
  await page.click('a:has-text("Add File/Link/External Tool")');
  await page.waitForTimeout(2000);

  // Click "Link"
  console.log(`    Clicking "Link"...`);
  await page.click('a.action-create-link');
  await page.waitForTimeout(2000);

  // Clear and fill URL field (has prefill text "Enter a url or embed code")
  console.log(`    Filling URL field...`);
  const urlField = await page.$('#edit-link');
  if (!urlField) {
    throw new Error('Could not find URL field (#edit-link)');
  }
  await urlField.click({ clickCount: 3 }); // select all existing text
  await urlField.fill(url);

  // Fill title field
  console.log(`    Filling title field...`);
  const titleField = await page.$('#edit-link-title');
  if (!titleField) {
    throw new Error('Could not find title field (#edit-link-title)');
  }
  await titleField.fill(title);

  // Submit
  console.log(`    Submitting...`);
  await page.click('#edit-submit');
  await page.waitForTimeout(3000); // wait for save and page update
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  // Dynamic import so arg parsing works even without playwright installed
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.error("Error: 'playwright' package not found.");
    console.error("Install it with:  npm install playwright");
    process.exit(1);
  }

  const { unit, lesson, courseId, dryRun, autoUrls } = opts;
  let blooketUrl = opts.blooketUrl;
  const titles = buildLinkTitles(unit, lesson);

  // Build the list of links to post
  let links = [];

  if (autoUrls) {
    // Auto-generate worksheet, drills, quiz URLs
    const auto = computeUrls(unit, lesson);
    const drillsLink = resolveDrillsLink(unit, lesson);

    if (drillsLink.status === "no-mode") {
      console.warn(`  WARNING: Could not auto-detect drill mode for ${unit}.${lesson}. Cartridge: ${drillsLink.cartridgeId}`);
    } else if (drillsLink.status === "no-manifest") {
      console.warn(`  WARNING: Manifest not found for drills cartridge ${drillsLink.cartridgeId}. Using cartridge root.`);
    } else if (drillsLink.status === "no-cartridge") {
      console.warn(`  WARNING: No cartridge mapped for unit ${unit}. Skipping drills.`);
    }

    if (auto.worksheet) {
      links.push({ key: "worksheet", url: auto.worksheet, title: titles.worksheet });
    }
    if (drillsLink.url) {
      links.push({ key: "drills", url: drillsLink.url, title: titles.drills });
    }
    if (auto.quiz && titles.quiz) {
      links.push({ key: "quiz", url: auto.quiz, title: titles.quiz });
    }

    // Override with explicit URLs if provided
    const upsertLink = (key, url, title) => {
      if (!url) return;
      const existing = links.find((link) => link.key === key);
      if (existing) {
        existing.url = url;
        if (title) existing.title = title;
        return;
      }
      links.push({ key, url, title });
    };

    if (opts.worksheetUrl) {
      upsertLink("worksheet", opts.worksheetUrl, titles.worksheet);
    }
    if (opts.drillsUrl) {
      upsertLink("drills", opts.drillsUrl, titles.drills);
    }
    if (opts.quizUrl) {
      upsertLink("quiz", opts.quizUrl, titles.quiz);
    }

    // Blooket: use explicit URL, or auto-upload CSV, or prompt
    // If --blooket not provided, check registry
    if (!blooketUrl) {
      const entry = getLesson(unit, lesson);
      if (entry?.urls?.blooket) {
        blooketUrl = entry.urls.blooket;
        console.log(`Using Blooket URL from registry: ${blooketUrl}`);
      }
    }

    if (blooketUrl) {
      links.push({ key: "blooket", url: blooketUrl, title: titles.blooket });
    } else {
      // Try auto-uploading the Blooket CSV via upload-blooket.mjs
      const csvPath = join(WORKSHEET_REPO, `u${unit}_l${lesson}_blooket.csv`);
      const uploadScript = SCRIPTS.uploadBlooket;
      let autoUrl = null;

      // Skip re-attempt if Blooket upload already failed this run
      const regEntry = getLesson(unit, lesson);
      if (regEntry?.status?.blooketUpload === "failed") {
        console.log("  Blooket upload already failed (registry), skipping re-attempt.");
      } else {
        try {
          const { existsSync } = await import("node:fs");
          const { execSync } = await import("node:child_process");
          if (existsSync(csvPath) && existsSync(uploadScript)) {
            console.log(`  Auto-uploading Blooket CSV: ${csvPath}`);
            const output = execSync(
              `node "${uploadScript}" --unit ${unit} --lesson ${lesson}`,
              { encoding: "utf-8", timeout: 60000 }
            );
            // Extract URL from output (looks for https://dashboard.blooket.com/set/...)
            const urlMatch = output.match(/https:\/\/dashboard\.blooket\.com\/set\/[a-z0-9]+/i);
            if (urlMatch) {
              autoUrl = urlMatch[0];
              console.log(`  Blooket URL: ${autoUrl}`);
            }
          }
        } catch (e) {
          console.log(`  Blooket auto-upload failed: ${e.message}`);
        }
      }

      if (autoUrl) {
        blooketUrl = autoUrl;
        links.push({ key: "blooket", url: autoUrl, title: titles.blooket });
      } else if (opts.noPrompt || !process.stdin.isTTY) {
        console.log("  Skipping Blooket URL prompt (non-interactive mode).");
      } else {
        const blooketInput = await promptUser("Enter Blooket URL (or press Enter to skip): ");
        if (blooketInput) {
          blooketUrl = blooketInput;
          links.push({ key: "blooket", url: blooketInput, title: titles.blooket });
        } else {
          console.log("  Skipping Blooket (no URL provided).");
        }
      }
    }
  } else {
    // Manual mode — use only explicitly provided URLs
    if (opts.worksheetUrl) {
      links.push({ key: "worksheet", url: opts.worksheetUrl, title: titles.worksheet });
    }
    if (opts.drillsUrl) {
      links.push({ key: "drills", url: opts.drillsUrl, title: titles.drills });
    }
    if (opts.quizUrl) {
      links.push({ key: "quiz", url: opts.quizUrl, title: titles.quiz });
    }
    if (blooketUrl) {
      links.push({ key: "blooket", url: blooketUrl, title: titles.blooket });
    }

    if (links.length === 0) {
      console.error("Error: No URLs provided. Use --worksheet, --drills, --quiz, --blooket, or --auto-urls.");
      process.exit(1);
    }
  }

  // --skip-missing: remove worksheet link if local file doesn't exist
  if (opts.skipMissing) {
    const worksheetLink = links.find(l => l.key === "worksheet");
    if (worksheetLink) {
      const filename = `u${unit}_lesson${lesson}_live.html`;
      const localPath = join(WORKSHEET_REPO, filename);
      if (!existsSync(localPath)) {
        console.log(`  SKIP: worksheet file not found locally \u2014 ${filename}`);
        links = links.filter(l => l.key !== "worksheet");
      }
    }
  }

  // Add video links if requested
  if (opts.withVideos) {
    const videoLinks = loadVideoLinks(unit, lesson);
    if (videoLinks.length > 0) {
      console.log(`  Found ${videoLinks.length} AP Classroom video(s) for ${unit}.${lesson}`);
      links.push(...videoLinks);
    }
  }

  if (autoUrls && opts.only) {
    links = links.filter((link) => link.key === opts.only || link.key.startsWith(opts.only));
    if (links.length === 0) {
      console.error(`Error: --only "${opts.only}" but no matching link was generated.`);
      process.exit(1);
    }
  }

  // Print summary
  console.log(`\nSchoology Link Poster — Unit ${unit}, Lesson ${lesson}`);
  console.log(`Course ID: ${courseId}`);
  console.log(`Dry run: ${dryRun}`);
  if (opts.createFolder) {
    console.log(`Create folder: "${opts.createFolder}"`);
    if (opts.folderDesc) console.log(`  Description: ${opts.folderDesc.substring(0, 80)}...`);
  }
  console.log(`\nLinks to post (${links.length}):`);
  for (const link of links) {
    console.log(`  [${link.key}] "${link.title}"`);
    console.log(`           ${link.url}`);
  }
  console.log();

  if (dryRun) {
    console.log("Dry run complete. No links were posted.");
    return;
  }

  // Root-posting guard: refuse to post if no folder destination can be determined
  const hasFolderDest = opts.createFolder || opts.targetFolder || opts.folderPath || opts.heal;
  if (!hasFolderDest) {
    // Try auto-resolving from topic schedule before giving up
    let canAutoResolve = false;
    try {
      await resolveFolderPath(unit, lesson, { period: 'B' });
      canAutoResolve = true;
    } catch { /* no schedule entry */ }

    if (!canAutoResolve) {
      console.error('\nERROR: No folder destination specified. Materials would post to Schoology root.');
      console.error('  Use --folder-path, --target-folder, or --create-folder.');
      console.error('  Or add the topic to config/topic-schedule.json.');
      console.error('  Or run via lesson-prep.mjs which resolves folders automatically.');
      process.exit(1);
    }
  }

  // Determine which courses to post to
  const courseIds = opts.courses
    ? opts.courses.split(',').map(c => c.trim()).filter(Boolean)
    : [opts.courseId];

  // Connect to browser via CDP (once, shared across courses)
  console.log(`Connecting to browser via CDP...`);
  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology.com" });

  let totalSuccess = 0;
  let totalFail = 0;

  // Build sparse materialUrls from the canonical links array (topic-global, built once)
  const materialUrls = {};
  for (const l of links) {
    if (l.key === 'worksheet' && l.url) materialUrls.worksheetUrl = l.url;
    if (l.key === 'drills' && l.url)    materialUrls.drillsUrl = l.url;
    if (l.key === 'quiz' && l.url)      materialUrls.quizUrl = l.url;
    if (l.key === 'blooket' && l.url)   materialUrls.blooketUrl = l.url;
  }

  for (const currentCourseId of courseIds) {
  const currentPeriod = detectPeriod(currentCourseId);
  const currentFolderUrlKey = currentPeriod === 'E' ? 'schoologyFolderE' : 'schoologyFolder';
  const currentRootMaterialsUrl = `${BASE_URL}/course/${currentCourseId}/materials`;

  if (courseIds.length > 1) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`  Posting to Period ${currentPeriod} (course ${currentCourseId})`);
    console.log("=".repeat(50));
  }

  // Reset per-course links (clone from master list)
  let courseLinks = links.map(l => ({ ...l }));

  let successCount = 0;
  let failCount = 0;

  // Per-course folder resolution: when posting to multiple courses, resolve
  // folder path per-period since Period B and E have different schedules
  let courseFolderPath = opts.folderPath;
  let courseCreateFolder = opts.createFolder;
  if (courseIds.length > 1 || (!opts.folderPath && !opts.targetFolder && !opts.heal)) {
    try {
      const folderInfo = await resolveFolderPath(unit, lesson, { period: currentPeriod });
      courseFolderPath = folderInfo.folderPath.join('::');
      courseCreateFolder = folderInfo.dayTitle;
      console.log(`  Folder resolved for Period ${currentPeriod}: ${folderInfo.folderPath.join(' → ')} / ${folderInfo.dayTitle}`);
    } catch (err) {
      console.error(`  FOLDER RESOLUTION FAILED for Period ${currentPeriod}: ${err.message}`);
      console.error("  ABORTING posting for this course — refusing to post to root.");
      totalFail += links.length;
      continue; // skip to next course
    }
  }

  // Determine the materials page URL (root, or folder if creating one)
  let materialsUrl = currentRootMaterialsUrl;

  // --heal mode: determine materialsUrl from registry if not explicit
  if (opts.heal && !opts.targetFolder) {
    const regEntry = getLesson(unit, lesson);
    if (regEntry?.urls?.[currentFolderUrlKey]) {
      materialsUrl = regEntry.urls[currentFolderUrlKey];
      console.log(`  [heal] Using folder from registry: ${materialsUrl}`);
    }
  }

  // --heal mode: DOM discovery fallback when registry had no folder URL
  if (opts.heal && materialsUrl === currentRootMaterialsUrl && !opts.targetFolder) {
    console.log(`  [heal] No folder in registry — scanning Schoology folders...`);
    const discovered = await discoverLessonFolder(page, unit, lesson, currentRootMaterialsUrl);
    if (discovered) {
      materialsUrl = discovered.folderUrl;
      updateUrl(unit, lesson, currentFolderUrlKey, discovered.folderUrl);
      console.log(`  [heal] Discovered folder: "${discovered.folderTitle}" → ${discovered.folderUrl}`);
    }
  }

  // Use existing folder (--target-folder), navigate path (--folder-path), or create new (--create-folder)
  if (opts.targetFolder) {
    materialsUrl = opts.targetFolder;
    console.log(`  Using existing folder: ${materialsUrl}`);
  } else if (courseFolderPath) {
    try {
      const { navigatePath, materialsUrl: buildMaterialsUrl } = await import('./lib/schoology-dom.mjs');
      // Split on :: (pipe separator) to preserve folder names containing "/"
      // e.g., "work-ahead/future::Week 26" → ["work-ahead/future", "Week 26"]
      const pathSegments = courseFolderPath.split('::').map(s => s.trim()).filter(Boolean);
      console.log(`  Navigating folder path: ${pathSegments.join(' → ')}`);
      const parentFolderId = await navigatePath(page, currentCourseId, pathSegments, { createMissing: true });
      const parentUrl = buildMaterialsUrl(currentCourseId, parentFolderId);

      // If --create-folder is also specified, create the day folder inside the resolved parent
      if (courseCreateFolder) {
        // Check if day folder already exists before creating (prevents duplicates on retry)
        const { findFolderByName, materialsUrl: buildUrl } = await import('./lib/schoology-dom.mjs');
        await page.goto(parentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const existingDay = await findFolderByName(page, courseCreateFolder);
        if (existingDay) {
          materialsUrl = buildUrl(currentCourseId, existingDay.id);
          console.log(`  Reusing existing day folder: "${courseCreateFolder}" (id: ${existingDay.id})`);
        } else {
          await createFolder(page, courseCreateFolder, opts.folderDesc, parentUrl);
          materialsUrl = await extractFolderUrl(page, courseCreateFolder, parentUrl);
        }
        updateUrl(unit, lesson, currentFolderUrlKey, materialsUrl);
        const folderIdMatch = materialsUrl.match(/[?&]f=(\d+)/);
        setSchoologyState(unit, lesson, {
          folderId: folderIdMatch ? folderIdMatch[1] : null,
          folderPath: [...pathSegments, courseCreateFolder],
          folderTitle: courseCreateFolder,
          verifiedAt: null,
          reconciledAt: null,
          materials: {},
        }, currentPeriod);
        const sbFolderId = folderIdMatch ? folderIdMatch[1] : null;
        if (sbFolderId) await syncFolderToSupabase(unit, lesson, currentPeriod, sbFolderId, materialUrls);
        console.log(`  Day folder created inside path: ${materialsUrl}`);
      } else {
        // Post directly into the resolved parent folder
        materialsUrl = parentUrl;
        updateUrl(unit, lesson, currentFolderUrlKey, materialsUrl);
        const folderIdMatch = materialsUrl.match(/[?&]f=(\d+)/);
        setSchoologyState(unit, lesson, {
          folderId: folderIdMatch ? folderIdMatch[1] : null,
          folderPath: pathSegments,
          folderTitle: pathSegments[pathSegments.length - 1] || null,
          verifiedAt: null,
          reconciledAt: null,
          materials: {},
        }, currentPeriod);
        const sbFolderId = folderIdMatch ? folderIdMatch[1] : null;
        if (sbFolderId) await syncFolderToSupabase(unit, lesson, currentPeriod, sbFolderId, materialUrls);
        console.log(`  Posting into: ${materialsUrl}`);
      }
    } catch (err) {
      console.error(`  FOLDER PATH NAVIGATION FAILED: ${err.message}`);
      console.error("  ABORTING posting for this course — refusing to post to root.");
      totalFail += courseLinks.length;
      continue; // skip to next course
    }
  } else if (courseCreateFolder) {
    try {
      // Check if folder already exists before creating (prevents duplicates on retry)
      const { findFolderByName, materialsUrl: buildUrl } = await import('./lib/schoology-dom.mjs');
      await page.goto(currentRootMaterialsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      const existingDay = await findFolderByName(page, courseCreateFolder);
      if (existingDay) {
        materialsUrl = buildUrl(currentCourseId, existingDay.id);
        console.log(`  Reusing existing day folder: "${courseCreateFolder}" (id: ${existingDay.id})`);
      } else {
        await createFolder(page, courseCreateFolder, opts.folderDesc, currentRootMaterialsUrl);
        materialsUrl = await extractFolderUrl(page, courseCreateFolder, currentRootMaterialsUrl);
      }
      updateUrl(unit, lesson, currentFolderUrlKey, materialsUrl);
      const folderIdMatch = materialsUrl.match(/[?&]f=(\d+)/);
      setSchoologyState(unit, lesson, {
        folderId: folderIdMatch ? folderIdMatch[1] : null,
        folderPath: [courseCreateFolder],
        folderTitle: courseCreateFolder,
        verifiedAt: null,
        reconciledAt: null,
        materials: {},
      }, currentPeriod);
      const sbFolderId = folderIdMatch ? folderIdMatch[1] : null;
      if (sbFolderId) await syncFolderToSupabase(unit, lesson, currentPeriod, sbFolderId, materialUrls);
      console.log(`  Folder URL saved to registry: ${materialsUrl}`);
    } catch (err) {
      console.error(`  FOLDER CREATION FAILED: ${err.message}`);
      console.error("  ABORTING posting for this course — refusing to post to root.");
      totalFail += courseLinks.length;
      continue; // skip to next course
    }
  }

  // --heal mode: audit folder and filter out existing links
  if (opts.heal && materialsUrl === currentRootMaterialsUrl) {
    console.error(`  [heal] No folder found for ${unit}.${lesson}. ABORTING — refusing to post to root.`);
    console.error(`  Use --create-folder or --target-folder to specify a destination.`);
    totalFail += courseLinks.length;
    continue; // skip to next course
  } else if (opts.heal && materialsUrl !== currentRootMaterialsUrl) {
    console.log(`\n[heal] Auditing Schoology folder...`);
    const expectedLinks = courseLinks.length > 0 ? courseLinks : buildExpectedLinks(unit, lesson, { blooketUrl });
    const audit = await auditSchoologyFolder(page, materialsUrl, expectedLinks);

    console.log(`  Found ${audit.existing.length} existing link(s) in folder`);
    console.log(`  Matched: ${audit.matched.length}, Missing: ${audit.missing.length}`);

    // Update registry for matched (already-posted) links
    for (const m of audit.matched) {
      updateSchoologyLink(unit, lesson, m.key, {
        status: "done",
        postedAt: new Date().toISOString(),
        title: m.title,
        verifiedExisting: true,
      });
      console.log(`  [heal] ✓ ${m.key} already posted`);
    }

    // Replace links array with only the missing ones
    courseLinks = audit.missing;

    if (courseLinks.length === 0) {
      console.log(`\n[heal] All links already present. Nothing to post.`);
      updateStatus(unit, lesson, "schoology", "done");
      totalSuccess += successCount;
      totalFail += failCount;
      continue; // next course
    }

    console.log(`\n[heal] Will post ${courseLinks.length} missing link(s):`);
    for (const link of courseLinks) {
      console.log(`  [${link.key}] "${link.title}"`);
    }
    console.log();

    // --heal mode: scan root for orphaned links and delete them
    console.log(`\n[heal] Scanning root for orphaned links...`);
    const orphans = await findOrphanedLinks(page, unit, lesson, currentRootMaterialsUrl);

    if (orphans.length > 0) {
      console.log(`  Found ${orphans.length} orphan(s) at root level:`);

      let deletedCount = 0;
      for (const orphan of orphans) {
        const orphanLower = orphan.title.toLowerCase().trim();
        const inFolder = audit.matched.some((m) => m.title.toLowerCase().trim() === orphanLower);
        const willPost = courseLinks.some((l) => l.title.toLowerCase().trim() === orphanLower);

        if (!inFolder && !willPost) {
          console.log(`    [orphan] "${orphan.title}" (${orphan.linkViewId}) — no folder copy, skipping`);
          continue;
        }

        const reason = inFolder ? "already in folder" : "will be posted to folder";
        console.log(`    [orphan] "${orphan.title}" (${orphan.linkViewId}) — ${reason}, deleting`);

        await page.goto(currentRootMaterialsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);

        const result = await deleteSchoologyLink(page, orphan.linkViewId);
        if (result.deleted) {
          deletedCount++;
        } else {
          console.log(`    [orphan] Failed to delete: ${result.reason}`);
        }
      }

      if (deletedCount > 0) {
        console.log(`  [heal] Deleted ${deletedCount} orphan(s) from root.`);
      }
    } else {
      console.log(`  No orphaned links found at root.`);
    }
  }

  // Post each link (inside folder if we navigated into one, else at top level)
  for (let i = 0; i < courseLinks.length; i++) {
    const link = courseLinks[i];
    console.log(`\n[${i + 1}/${courseLinks.length}] Posting: ${link.title}`);
    console.log(`  URL: ${link.url}`);

    try {
      await postLink(page, link.url, link.title, materialsUrl);
      console.log(`  SUCCESS: "${link.title}" posted.`);
      successCount++;

      // --heal mode: verify and update per-link registry
      let verifiedOk = false;
      if (opts.heal) {
        verifiedOk = await verifyPostedLink(page, link.title, materialsUrl);
        updateSchoologyLink(unit, lesson, link.key, {
          status: verifiedOk ? "done" : "failed",
          postedAt: new Date().toISOString(),
          title: link.title,
          verified: verifiedOk,
        });
        if (verifiedOk) {
          console.log(`  [heal] ✓ Verified: "${link.title}" appears in folder`);
        } else {
          console.log(`  [heal] ⚠ Posted but not verified: "${link.title}"`);
        }
      }

      // Store material state in unified schoology registry
      updateSchoologyMaterial(unit, lesson, link.key, {
        schoologyId: null,
        title: link.title,
        href: null,
        targetUrl: link.url,
        postedAt: new Date().toISOString(),
        verified: verifiedOk,
        status: "done",
      }, currentPeriod);
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failCount++;

      if (opts.heal) {
        updateSchoologyLink(unit, lesson, link.key, {
          status: "failed",
          error: err.message,
          attemptedAt: new Date().toISOString(),
          title: link.title,
        });
      }

      updateSchoologyMaterial(unit, lesson, link.key, {
        targetUrl: link.url,
        status: "failed",
        error: err.message,
        attemptedAt: new Date().toISOString(),
      }, currentPeriod);
    }

    // Delay between posts to avoid overwhelming Schoology
    if (i < courseLinks.length - 1) {
      console.log("  Waiting 3 seconds before next post...");
      await page.waitForTimeout(3000);
    }
  }

  // Calendar link posting removed — replaced by ap_stats_roadmap.html

  if (failCount === 0) {
    updateStatus(unit, lesson, "schoology", "done");
  }

  totalSuccess += successCount;
  totalFail += failCount;

  } // end course loop

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Done. ${totalSuccess} posted, ${totalFail} failed.`);
  console.log("=".repeat(50));

  // Disconnect without closing the browser
  console.log("\nDisconnecting from browser (CDP). Your browser remains open.");
  if (browser) {
    await browser.close(); // close() on a CDP browser just disconnects
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
