#!/usr/bin/env node
/**
 * upload-blooket.mjs — Create a Blooket set from a CSV file via Playwright CDP.
 *
 * Connects to an already-running browser via Chrome DevTools Protocol (CDP) so the
 * user's Blooket session is available.
 *
 * Usage:
 *   # Upload using unit/lesson auto-detection
 *   node scripts/upload-blooket.mjs --unit 6 --lesson 5
 *
 *   # Upload with explicit file and title
 *   node scripts/upload-blooket.mjs --file "C:/Users/ColsonR/apstats-live-worksheet/u6_l5_blooket.csv" --title "AP Stats 6.5 Review"
 *
 *   # Dry run — show what would happen
 *   node scripts/upload-blooket.mjs --unit 6 --lesson 5 --dry-run
 *
 * Start Edge with remote debugging first:
 *   scripts/start-edge-debug.cmd
 *
 * Prerequisites:
 *   npm install playwright
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { connectCDP } from "./lib/cdp-connect.mjs";

// Playwright is imported dynamically in main() so that arg parsing and --help
// work even if the package isn't installed yet.
let chromium;

// ── Config ──────────────────────────────────────────────────────────────────

const CSV_BASE_DIR = "C:/Users/ColsonR/apstats-live-worksheet";

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let unit = null;
  let lesson = null;
  let file = null;
  let title = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--unit" || arg === "-u") {
      unit = parseInt(args[++i], 10);
    } else if (arg === "--lesson" || arg === "-l") {
      lesson = parseInt(args[++i], 10);
    } else if (arg === "--file" || arg === "-f") {
      file = args[++i];
    } else if (arg === "--title" || arg === "-t") {
      title = args[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  // Validate: need either (unit + lesson) or explicit file
  if (!file && (!unit || !lesson)) {
    printUsage();
    process.exit(1);
  }

  // Auto-detect CSV path from unit/lesson
  if (!file && unit && lesson) {
    file = `${CSV_BASE_DIR}/u${unit}_l${lesson}_blooket.csv`;
  }

  // Auto-generate title
  if (!title) {
    if (unit && lesson) {
      title = `AP Stats ${unit}.${lesson} Review`;
    } else {
      // Derive from filename
      const basename = file.replace(/\\/g, "/").split("/").pop().replace(/\.csv$/i, "");
      title = basename;
    }
  }

  return { unit, lesson, file, title, dryRun };
}

function printUsage() {
  console.log(
    "Usage: node scripts/upload-blooket.mjs [options]\n\n" +
      "Options:\n" +
      "  -u, --unit <N>      Unit number (auto-detects CSV file)\n" +
      "  -l, --lesson <N>    Lesson number\n" +
      "  -f, --file <path>   Explicit CSV file path (overrides auto-detect)\n" +
      "  -t, --title <text>  Set title (overrides auto-generated)\n" +
      "  --dry-run            Show what would happen without creating\n" +
      "  -h, --help           Show this help\n\n" +
      "Examples:\n" +
      '  node scripts/upload-blooket.mjs --unit 6 --lesson 5\n' +
      '  node scripts/upload-blooket.mjs --file "./my_quiz.csv" --title "My Quiz"\n'
  );
}

// ── Upload flow ─────────────────────────────────────────────────────────────

async function uploadBlooket(page, csvPath, title) {
  // Step 1: Create the set
  console.log("\n[Step 1] Creating set...");
  await page.goto("https://dashboard.blooket.com/create", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  // Select CSV Upload radio
  console.log('  Clicking "CSV Upload" radio...');
  await page.click('label:has-text("CSV Upload")');
  await page.waitForTimeout(500);

  // Fill title
  console.log(`  Filling title: "${title}"`);
  await page.fill("#title", title);
  await page.waitForTimeout(300);

  // Click Create Set
  console.log('  Clicking "Create Set"...');
  await page.click('button:has-text("Create Set")');

  // Wait for redirect to edit page
  console.log("  Waiting for redirect to edit page...");
  await page.waitForURL("**/edit?id=*", { timeout: 15000 }).catch(() => {
    // Fallback: just wait
    console.log("  URL pattern match timed out, waiting additional time...");
  });
  await page.waitForTimeout(3000);

  // Step 2: Upload CSV
  console.log("\n[Step 2] Uploading CSV...");
  const editUrl = page.url();
  const parsedUrl = new URL(editUrl);
  const setId = parsedUrl.searchParams.get("id");

  if (!setId) {
    throw new Error(
      `Could not extract set ID from URL: ${editUrl}\n` +
        "Make sure you are logged in to Blooket in the browser."
    );
  }
  console.log(`  Set ID: ${setId}`);

  // Find the CSV file input and upload
  const fileInput = await page.$('input[type="file"][accept=".csv"]');
  if (!fileInput) {
    throw new Error(
      'Could not find CSV file input (input[type="file"][accept=".csv"]). ' +
        "The page may not have loaded the CSV import panel."
    );
  }

  console.log(`  Setting file: ${csvPath}`);
  await fileInput.setInputFiles(csvPath);
  await page.waitForTimeout(2000);

  // Click "Upload CSV" button if present
  const uploadBtn = await page.$('div:has-text("Upload CSV")');
  if (uploadBtn) {
    console.log('  Clicking "Upload CSV" button...');
    await uploadBtn.click();
    await page.waitForTimeout(3000);
  }

  // Wait for questions to appear
  console.log("  Waiting for questions to load...");
  try {
    await page.waitForFunction(
      () => {
        const body = document.body.innerText;
        return /\d+\s*Questions?/i.test(body);
      },
      { timeout: 15000 }
    );
    // Extract the question count for confirmation
    const questionCount = await page.evaluate(() => {
      const match = document.body.innerText.match(/(\d+)\s*Questions?/i);
      return match ? match[1] : null;
    });
    if (questionCount) {
      console.log(`  Loaded ${questionCount} question(s).`);
    }
  } catch {
    console.log(
      "  WARNING: Could not confirm question count. Proceeding with save anyway."
    );
  }

  // Step 3: Save
  console.log("\n[Step 3] Saving set...");
  // Try the specific save button class first, then fall back to text match
  const saveBtn =
    (await page.$('div[class*="saveButton"]:has-text("Save Set")')) ||
    (await page.$('div:has-text("Save Set")'));

  if (!saveBtn) {
    throw new Error(
      'Could not find "Save Set" button. The set may not have loaded properly.'
    );
  }

  await saveBtn.click();
  await page.waitForTimeout(3000);

  // Confirm save by waiting for any success indication or URL stability
  console.log("  Save complete.");

  // Step 4: Return URL
  const blooketUrl = `https://dashboard.blooket.com/set/${setId}`;
  return blooketUrl;
}

// ── Clipboard helper ────────────────────────────────────────────────────────

function copyToClipboard(text) {
  try {
    // Windows: use clip.exe
    execSync(`echo ${text} | clip`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  // Validate CSV file exists
  if (!existsSync(opts.file)) {
    console.error(`Error: CSV file not found: ${opts.file}`);
    process.exit(1);
  }

  // Print summary
  console.log("Blooket CSV Uploader");
  console.log("====================");
  console.log(`  CSV file: ${opts.file}`);
  console.log(`  Title:    ${opts.title}`);
  if (opts.unit && opts.lesson) {
    console.log(`  Unit:     ${opts.unit}`);
    console.log(`  Lesson:   ${opts.lesson}`);
  }
  console.log(`  Dry run:  ${opts.dryRun}`);

  if (opts.dryRun) {
    console.log("\nDry run complete. No set was created.");
    const previewUrl = `https://dashboard.blooket.com/set/{SET_ID}`;
    console.log(`\nWould create set and return URL like: ${previewUrl}`);
    return;
  }

  // Dynamic import so arg parsing works even without playwright installed
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.error("Error: 'playwright' package not found.");
    console.error("Install it with:  npm install playwright");
    process.exit(1);
  }

  // Connect to browser via CDP
  console.log(`\nConnecting to browser via CDP...`);
  const { browser, page } = await connectCDP(chromium, { preferUrl: "blooket" });

  try {
    const blooketUrl = await uploadBlooket(page, opts.file, opts.title);

    // Print result
    console.log("\n" + "=".repeat(50));
    console.log("SUCCESS!");
    console.log("=".repeat(50));
    console.log(`\n  Blooket URL: ${blooketUrl}\n`);

    // Copy to clipboard
    const copied = copyToClipboard(blooketUrl);
    if (copied) {
      console.log("  (Copied to clipboard)");
    }
  } catch (err) {
    console.error("\nFAILED:", err.message);
    process.exit(1);
  } finally {
    // Disconnect without closing the browser
    console.log(
      "\nDisconnecting from browser (CDP). Your browser remains open."
    );
    if (browser) {
      await browser.close(); // close() on a CDP browser just disconnects
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
