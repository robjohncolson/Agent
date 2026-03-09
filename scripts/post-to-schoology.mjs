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

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { connectCDP } from "./lib/cdp-connect.mjs";
import { CARTRIDGES_DIR, UNITS_JS_PATH, WORKSHEET_REPO, SCRIPTS } from "./lib/paths.mjs";
import { getLesson, updateStatus, updateUrl, updateSchoologyLink } from "./lib/lesson-registry.mjs";
import { auditSchoologyFolder, buildExpectedLinks, deleteSchoologyLink, discoverLessonFolder, findOrphanedLinks, verifyPostedLink } from "./lib/schoology-heal.mjs";

// Playwright is imported dynamically in main() so that arg parsing and --help
// work even if the package isn't installed yet.
let chromium;

// ── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  baseUrl: "https://lynnschools.schoology.com",
  courses: {
    "period-b": "7945275782",
  },
  cartridgeMap: {
    "5": "apstats-u5-sampling-dist",
    "6": "apstats-u6-inference-prop",
    "7": "apstats-u7-mean-ci",
  },
};

const DEFAULT_COURSE_ID = "7945275782";

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
  let calendarLink = null;
  let calendarTitle = null;
  let noPrompt = false;
  let targetFolder = null;
  let heal = false;

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
    } else if (arg === "--calendar-link") {
      calendarLink = args[++i];
    } else if (arg === "--calendar-title") {
      calendarTitle = args[++i];
    } else if (arg === "--no-prompt") {
      noPrompt = true;
    } else if (arg === "--target-folder") {
      targetFolder = args[++i];
    } else if (arg === "--heal") {
      heal = true;
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
        "  --calendar-link   URL for calendar link (posted at top level, outside folder)\n" +
        "  --calendar-title  Title for the calendar link\n" +
        "  --no-prompt       Skip interactive prompts (for automated/pipeline use)\n" +
        "  --target-folder   Post into an existing folder URL (skip folder creation)\n" +
        "  --heal            Heal mode: audit folder, post only missing links, verify\n"
    );
    process.exit(1);
  }

  return { unit, lesson, worksheetUrl, drillsUrl, quizUrl, blooketUrl, autoUrls, only, courseId, dryRun, createFolder, folderDesc, withVideos, calendarLink, calendarTitle, noPrompt, targetFolder, heal };
}

// ── Auto-URL generation ─────────────────────────────────────────────────────

/**
 * Find the first drill mode matching a given unit.lesson from the cartridge manifest.
 */
function findFirstDrillMode(unit, lesson) {
  const cartridgeId = CONFIG.cartridgeMap[String(unit)];
  if (!cartridgeId) {
    return { cartridgeId: null, modeId: null };
  }

  const manifestPath = join(
    CARTRIDGES_DIR,
    cartridgeId,
    "manifest.json"
  );

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return { cartridgeId, modeId: null };
  }

  const prefix = `${unit}.${lesson}`;
  const modes = manifest.modes || [];
  const match = modes.find((m) => m.name && m.name.startsWith(prefix));

  if (match) {
    return { cartridgeId, modeId: match.id };
  }

  return { cartridgeId, modeId: null };
}

/**
 * Build auto-generated URLs for worksheet, drills, and quiz.
 */
function buildAutoUrls(unit, lesson) {
  // Worksheet
  const worksheetUrl =
    `https://robjohncolson.github.io/apstats-live-worksheet/u${unit}_lesson${lesson}_live.html`;

  // Drills
  let drillsUrl = null;
  const { cartridgeId, modeId } = findFirstDrillMode(unit, lesson);
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

function buildLinkTitles(unit, lesson) {
  return {
    worksheet: `Topic ${unit}.${lesson} — Follow-Along Worksheet`,
    drills: `Topic ${unit}.${lesson} — Drills`,
    quiz: `Quiz ${unit}.${lesson - 1}`,
    blooket: `Topic ${unit}.${lesson} — Blooket Review`,
  };
}

// ── Video links from units.js ───────────────────────────────────────────────


/**
 * Load AP Classroom video URLs for a given unit.lesson from units.js.
 * Returns array of { url, title } objects.
 */
function loadVideoLinks(unit, lesson) {
  if (!existsSync(UNITS_JS_PATH)) {
    console.warn(`  WARNING: ${UNITS_JS_PATH} not found. Skipping video links.`);
    return [];
  }

  const content = readFileSync(UNITS_JS_PATH, "utf-8");
  const lessonId = `${unit}-${lesson}`;

  // Find the lesson block by its id
  const idIndex = content.indexOf(`id: "${lessonId}"`);
  if (idIndex === -1) {
    console.warn(`  WARNING: Lesson ${lessonId} not found in units.js. Skipping video links.`);
    return [];
  }

  // Extract the description
  const afterId = content.substring(idIndex, idIndex + 500);
  const descMatch = afterId.match(/description:\s*"([^"]+)"/);
  const description = descMatch ? descMatch[1] : "";

  // Find the videos array for this lesson (before the next lesson block)
  const nextIdIndex = content.indexOf(`id: "`, idIndex + 10);
  const lessonBlock = nextIdIndex !== -1
    ? content.substring(idIndex, nextIdIndex)
    : content.substring(idIndex, idIndex + 1000);

  const urls = [];
  const urlRegex = /url:\s*"(https:\/\/apclassroom\.collegeboard\.org\/[^"]+)"/g;
  let m;
  while ((m = urlRegex.exec(lessonBlock)) !== null) {
    urls.push(m[1]);
  }

  return urls.map((url, i) => ({
    key: `video${i + 1}`,
    url,
    title: urls.length === 1
      ? `Topic ${unit}.${lesson} — AP Classroom Video`
      : `Topic ${unit}.${lesson} — AP Classroom Video ${i + 1}`,
  }));
}

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
      const folderUrl = `${materialsUrl}?f=${folderId}`;
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
  const rootMaterialsUrl = `${CONFIG.baseUrl}/course/${courseId}/materials`;

  // Build the list of links to post
  let links = [];

  if (autoUrls) {
    // Auto-generate worksheet, drills, quiz URLs
    const auto = buildAutoUrls(unit, lesson);

    if (auto.worksheetUrl) {
      links.push({ key: "worksheet", url: auto.worksheetUrl, title: titles.worksheet });
    }
    if (auto.drillsUrl) {
      links.push({ key: "drills", url: auto.drillsUrl, title: titles.drills });
    }
    if (auto.quizUrl) {
      links.push({ key: "quiz", url: auto.quizUrl, title: titles.quiz });
    }

    // Override with explicit URLs if provided
    if (opts.worksheetUrl) {
      const existing = links.find(l => l.key === "worksheet");
      if (existing) existing.url = opts.worksheetUrl;
    }
    if (opts.drillsUrl) {
      const existing = links.find(l => l.key === "drills");
      if (existing) existing.url = opts.drillsUrl;
    }
    if (opts.quizUrl) {
      const existing = links.find(l => l.key === "quiz");
      if (existing) existing.url = opts.quizUrl;
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

  // Add video links if requested
  if (opts.withVideos) {
    const videoLinks = loadVideoLinks(unit, lesson);
    if (videoLinks.length > 0) {
      console.log(`  Found ${videoLinks.length} AP Classroom video(s) for ${unit}.${lesson}`);
      links.push(...videoLinks);
    }
  }

  if (autoUrls && opts.only) {
    links = links.filter((link) => link.key === opts.only);
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
  if (opts.calendarLink) {
    console.log(`Calendar link (top level): ${opts.calendarLink}`);
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

  // Connect to browser via CDP
  console.log(`Connecting to browser via CDP...`);
  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology.com" });

  let successCount = 0;
  let failCount = 0;

  // Determine the materials page URL (root, or folder if creating one)
  let materialsUrl = rootMaterialsUrl;

  // --heal mode: determine materialsUrl from registry if not explicit
  if (opts.heal && !opts.targetFolder) {
    const regEntry = getLesson(unit, lesson);
    if (regEntry?.urls?.schoologyFolder) {
      materialsUrl = regEntry.urls.schoologyFolder;
      console.log(`  [heal] Using folder from registry: ${materialsUrl}`);
    }
  }

  // --heal mode: DOM discovery fallback when registry had no folder URL
  if (opts.heal && materialsUrl === rootMaterialsUrl && !opts.targetFolder) {
    console.log(`  [heal] No folder in registry — scanning Schoology folders...`);
    const discovered = await discoverLessonFolder(page, unit, lesson, rootMaterialsUrl);
    if (discovered) {
      materialsUrl = discovered.folderUrl;
      updateUrl(unit, lesson, "schoologyFolder", discovered.folderUrl);
      console.log(`  [heal] Discovered folder: "${discovered.folderTitle}" → ${discovered.folderUrl}`);
    }
  }

  // Use existing folder (--target-folder) or create a new one (--create-folder)
  if (opts.targetFolder) {
    materialsUrl = opts.targetFolder;
    console.log(`  Using existing folder: ${materialsUrl}`);
  } else if (opts.createFolder) {
    try {
      await createFolder(page, opts.createFolder, opts.folderDesc, rootMaterialsUrl);
      // Extract folder ID from DOM and build the scoped URL (?f=ID)
      materialsUrl = await extractFolderUrl(page, opts.createFolder, rootMaterialsUrl);
      // Persist the folder URL to the registry
      updateUrl(unit, lesson, "schoologyFolder", materialsUrl);
      console.log(`  Folder URL saved to registry: ${materialsUrl}`);
    } catch (err) {
      console.error(`  FOLDER CREATION FAILED: ${err.message}`);
      console.error("  Falling back to posting links at top level.");
      failCount++;
    }
  }

  // --heal mode: audit folder and filter out existing links
  if (opts.heal && materialsUrl === rootMaterialsUrl) {
    console.warn(`  [heal] ⚠ No folder found for ${unit}.${lesson}. Use --create-folder or --target-folder.`);
  } else if (opts.heal && materialsUrl !== rootMaterialsUrl) {
    console.log(`\n[heal] Auditing Schoology folder...`);
    const expectedLinks = links.length > 0 ? links : buildExpectedLinks(unit, lesson, { blooketUrl });
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
    links = audit.missing;

    if (links.length === 0) {
      console.log(`\n[heal] All links already present. Nothing to post.`);
      // Update overall status
      updateStatus(unit, lesson, "schoology", "done");
      if (browser) await browser.close();
      return;
    }

    console.log(`\n[heal] Will post ${links.length} missing link(s):`);
    for (const link of links) {
      console.log(`  [${link.key}] "${link.title}"`);
    }
    console.log();

    // --heal mode: scan root for orphaned links and delete them
    console.log(`\n[heal] Scanning root for orphaned links...`);
    const orphans = await findOrphanedLinks(page, unit, lesson, rootMaterialsUrl);

    if (orphans.length > 0) {
      console.log(`  Found ${orphans.length} orphan(s) at root level:`);

      // Build set of titles that are safe to delete:
      // - already confirmed in folder (audit.matched)
      // - will be posted to folder (audit.missing / links)
      const safeTitles = new Set([
        ...audit.matched.map((m) => m.title.toLowerCase().trim()),
        ...links.map((l) => l.title.toLowerCase().trim()),
      ]);

      let deletedCount = 0;
      for (const orphan of orphans) {
        const orphanLower = orphan.title.toLowerCase().trim();
        const inFolder = audit.matched.some((m) => m.title.toLowerCase().trim() === orphanLower);
        const willPost = links.some((l) => l.title.toLowerCase().trim() === orphanLower);

        if (!inFolder && !willPost) {
          console.log(`    [orphan] "${orphan.title}" (${orphan.linkViewId}) — no folder copy, skipping`);
          continue;
        }

        const reason = inFolder ? "already in folder" : "will be posted to folder";
        console.log(`    [orphan] "${orphan.title}" (${orphan.linkViewId}) — ${reason}, deleting`);

        // Navigate back to root for deletion
        await page.goto(rootMaterialsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
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
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    console.log(`\n[${i + 1}/${links.length}] Posting: ${link.title}`);
    console.log(`  URL: ${link.url}`);

    try {
      await postLink(page, link.url, link.title, materialsUrl);
      console.log(`  SUCCESS: "${link.title}" posted.`);
      successCount++;

      // --heal mode: verify and update per-link registry
      if (opts.heal) {
        const verified = await verifyPostedLink(page, link.title, materialsUrl);
        updateSchoologyLink(unit, lesson, link.key, {
          status: verified ? "done" : "failed",
          postedAt: new Date().toISOString(),
          title: link.title,
          verified,
        });
        if (verified) {
          console.log(`  [heal] ✓ Verified: "${link.title}" appears in folder`);
        } else {
          console.log(`  [heal] ⚠ Posted but not verified: "${link.title}"`);
        }
      }
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failCount++;

      // --heal mode: record failure in per-link registry
      if (opts.heal) {
        updateSchoologyLink(unit, lesson, link.key, {
          status: "failed",
          error: err.message,
          attemptedAt: new Date().toISOString(),
          title: link.title,
        });
      }
    }

    // Delay between posts to avoid overwhelming Schoology
    if (i < links.length - 1) {
      console.log("  Waiting 3 seconds before next post...");
      await page.waitForTimeout(3000);
    }
  }

  // Post calendar link at top level (outside folder) — skip if already exists
  if (opts.calendarLink) {
    const calTitle = opts.calendarTitle || "Weekly Calendar";
    console.log(`\nChecking for existing calendar link: "${calTitle}"...`);

    // Navigate to root materials and check for a link with matching title
    await page.goto(rootMaterialsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    const alreadyExists = await page.evaluate((title) => {
      // Material links appear as anchors inside material rows
      const links = document.querySelectorAll('.material-row a, .item-title a, a.sExtlink-processed, td.item-title a');
      for (const a of links) {
        if (a.textContent.trim() === title) return true;
      }
      // Also check plain text content in material rows
      const rows = document.querySelectorAll('.material-row, tr[id^="s-"]');
      for (const row of rows) {
        if (row.textContent.includes(title)) return true;
      }
      return false;
    }, calTitle);

    if (alreadyExists) {
      console.log(`  SKIPPED: "${calTitle}" already exists on the materials page.`);
    } else {
      console.log(`  Posting calendar link at top level: "${calTitle}"`);
      try {
        await postLink(page, opts.calendarLink, calTitle, rootMaterialsUrl);
        console.log(`  SUCCESS: Calendar link posted.`);
        successCount++;
      } catch (err) {
        console.error(`  FAILED: ${err.message}`);
        failCount++;
      }
    }
  }

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Done. ${successCount} posted, ${failCount} failed.`);
  console.log("=".repeat(50));

  if (failCount === 0) {
    updateStatus(unit, lesson, "schoology", "done");
  }

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
