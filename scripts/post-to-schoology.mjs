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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { connectCDP } from "./lib/cdp-connect.mjs";

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
        "  --dry-run         Show what would be posted without actually posting\n"
    );
    process.exit(1);
  }

  return { unit, lesson, worksheetUrl, drillsUrl, quizUrl, blooketUrl, autoUrls, only, courseId, dryRun };
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
    "C:/Users/ColsonR/lrsl-driller/cartridges",
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

// ── Post one link to Schoology ──────────────────────────────────────────────

async function postLink(page, url, title, courseId) {
  const materialsUrl = `${CONFIG.baseUrl}/course/${courseId}/materials`;

  // Navigate to materials page
  console.log(`    Navigating to materials page...`);
  await page.goto(materialsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
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
  const titles = buildLinkTitles(unit, lesson);

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
    if (opts.blooketUrl) {
      links.push({ key: "blooket", url: opts.blooketUrl, title: titles.blooket });
    } else {
      // Try auto-uploading the Blooket CSV via upload-blooket.mjs
      const csvPath = join("C:/Users/ColsonR/apstats-live-worksheet", `u${unit}_l${lesson}_blooket.csv`);
      const uploadScript = "C:/Users/ColsonR/Agent/scripts/upload-blooket.mjs";
      let autoUrl = null;

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

      if (autoUrl) {
        links.push({ key: "blooket", url: autoUrl, title: titles.blooket });
      } else {
        const blooketInput = await promptUser("Enter Blooket URL (or press Enter to skip): ");
        if (blooketInput) {
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
    if (opts.blooketUrl) {
      links.push({ key: "blooket", url: opts.blooketUrl, title: titles.blooket });
    }

    if (links.length === 0) {
      console.error("Error: No URLs provided. Use --worksheet, --drills, --quiz, --blooket, or --auto-urls.");
      process.exit(1);
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

  // Post each link
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    console.log(`\n[${ i + 1}/${links.length}] Posting: ${link.title}`);
    console.log(`  URL: ${link.url}`);

    try {
      await postLink(page, link.url, link.title, courseId);
      console.log(`  SUCCESS: "${link.title}" posted.`);
      successCount++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failCount++;
    }

    // Delay between posts to avoid overwhelming Schoology
    if (i < links.length - 1) {
      console.log("  Waiting 3 seconds before next post...");
      await page.waitForTimeout(3000);
    }
  }

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Done. ${successCount} posted, ${failCount} failed.`);
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
