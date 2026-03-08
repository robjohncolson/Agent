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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { connectCDP } from "./lib/cdp-connect.mjs";
import { CSV_BASE_DIR } from "./lib/paths.mjs";
import { getLesson, updateUrl, updateStatus } from "./lib/lesson-registry.mjs";

// Playwright is imported dynamically in main() so that arg parsing and --help
// work even if the package isn't installed yet.
let chromium;

// ── Config ──────────────────────────────────────────────────────────────────

const UPLOAD_LOG_PATH = join(import.meta.dirname, "../state/blooket-uploads.json");

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let unit = null;
  let lesson = null;
  let file = null;
  let title = null;
  let dryRun = false;
  let force = false;

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
    } else if (arg === "--force") {
      force = true;
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

  return { unit, lesson, file, title, dryRun, force };
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
      "  --force              Re-upload even if registry already has a successful URL\n" +
      "  -h, --help           Show this help\n\n" +
      "Examples:\n" +
      '  node scripts/upload-blooket.mjs --unit 6 --lesson 5\n' +
      '  node scripts/upload-blooket.mjs --file "./my_quiz.csv" --title "My Quiz"\n'
  );
}

// ── Modal dismissal ─────────────────────────────────────────────────────────

async function dismissModals(page) {
  const count = await page.evaluate(() => {
    let n = 0;
    // Hide modals so they don't intercept pointer events, but keep DOM intact
    document.querySelectorAll('div[class*="_modal_"]').forEach((m) => {
      m.style.display = "none";
      n++;
    });
    document.querySelectorAll('div[class*="_overlay_"], div[class*="_backdrop_"]').forEach((m) => {
      m.style.display = "none";
      n++;
    });
    return n;
  });
  if (count > 0) console.log(`  Hidden ${count} modal/overlay element(s).`);
}

// ── Selector helpers ────────────────────────────────────────────────────────

async function findButton(page, strategies, label) {
  for (const { selector, description } of strategies) {
    try {
      const el = await page.$(selector);
      if (el) {
        console.log(`  Found "${label}" via: ${description}`);
        return el;
      }
    } catch {
      // selector syntax not supported in this browser, skip
    }
  }
  return null;
}

async function dumpPageState(page) {
  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    visibleText: document.body.innerText.substring(0, 600),
    buttons: [...document.querySelectorAll('button, [role="button"], div[class*="button" i], a[class*="button" i]')]
      .slice(0, 20)
      .map(el => ({
        tag: el.tagName,
        text: (el.innerText || "").trim().substring(0, 80),
        classes: (el.className || "").substring(0, 100),
      })),
  }));
  console.error("\n  DEBUG — page state at failure:");
  console.error("  URL:", info.url);
  console.error("  Title:", info.title);
  console.error("  Visible text (first 600 chars):\n   ", info.visibleText.replace(/\n/g, "\n    "));
  console.error("  Clickable elements:", JSON.stringify(info.buttons, null, 2));
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
  // Real DOM: <input type="radio" value="csv"> inside <label class="ButtonPicker_radio__eRnhr">
  console.log('  Clicking "CSV Upload" radio...');
  const csvRadio = await findButton(page, [
    { selector: 'label:has-text("CSV Upload")', description: "label text (visible wrapper)" },
    { selector: 'label[class*="ButtonPicker"]:has-text("CSV")', description: "ButtonPicker label" },
    { selector: 'label[class*="radio"]:has-text("CSV")', description: "label radio class" },
    { selector: '[class*="csv" i]', description: "class contains csv" },
  ], "CSV Upload");
  if (!csvRadio) {
    await dumpPageState(page);
    throw new Error('Could not find "CSV Upload" option on the create page.');
  }
  await csvRadio.click();
  await page.waitForTimeout(500);

  // Fill title
  // Real DOM: <input type="text" name="title" class="TextInput_input__FyICi">
  console.log(`  Filling title: "${title}"`);
  const titleFilled = await page.fill('input[name="title"]', title).then(() => true).catch(() => false);
  if (!titleFilled) {
    // Fallback to old selector
    await page.fill("#title", title);
  }
  await page.waitForTimeout(300);

  // Click Create Set
  // Real DOM: <button type="submit" class="... CreateQuestionSetForm_submitButton__...">
  console.log('  Clicking "Create Set"...');
  const createBtn = await findButton(page, [
    { selector: 'button[type="submit"]:has-text("Create Set")', description: "submit button text" },
    { selector: 'button[type="submit"]', description: "submit button" },
    { selector: 'button:has-text("Create Set")', description: "button text" },
    { selector: 'button[class*="submitButton"]', description: "submitButton class" },
  ], "Create Set");
  if (!createBtn) {
    await dumpPageState(page);
    throw new Error('Could not find "Create Set" button.');
  }
  await createBtn.click();

  // Wait for redirect to edit page
  console.log("  Waiting for redirect to edit page...");
  await page.waitForURL("**/edit?id=*", { timeout: 15000 }).catch(() => {
    // Fallback: just wait
    console.log("  URL pattern match timed out, waiting additional time...");
  });
  await page.waitForTimeout(3000);

  // Dismiss any modal overlays (Blooket promo/tips/error dialogs)
  await dismissModals(page);

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

  // Click "Spreadsheet Import" button
  // Real DOM: <div class="_button_552gk_1 _addButton_1byfb_155" role="button">
  //   contains <div class="_addButtonInside_1byfb_159">Spreadsheet<br>Import</div>
  // NOTE: It's a div[role="button"], NOT a <button>. No element has "import" in class.
  console.log('  Clicking "Spreadsheet Import"...');
  const importBtn = await findButton(page, [
    { selector: 'div[role="button"]:has-text("Spreadsheet")', description: "div role=button Spreadsheet" },
    { selector: 'div[class*="addButton"]:has-text("Spreadsheet")', description: "addButton class+text" },
    { selector: 'div[class*="addButtonInside"]:has-text("Spreadsheet")', description: "addButtonInside text" },
    { selector: 'div[tabindex="0"]:has-text("Spreadsheet")', description: "tabindex div text" },
  ], "Spreadsheet Import");
  if (!importBtn) {
    await dumpPageState(page);
    throw new Error('Could not find "Spreadsheet Import" button on the edit page.');
  }
  await importBtn.click();
  await page.waitForTimeout(2000);

  // Now look for the file input in the import dialog
  let fileInput = await page.$('input[type="file"]');
  if (!fileInput) {
    await page.waitForSelector('input[type="file"]', { timeout: 10000 });
    fileInput = await page.$('input[type="file"]');
  }
  if (!fileInput) {
    throw new Error('Could not find file input after clicking Spreadsheet Import.');
  }

  console.log(`  Setting file: ${csvPath}`);
  await fileInput.setInputFiles(csvPath);
  await page.waitForTimeout(3000);

  // Click any "Import" or "Upload" confirmation button in the dialog
  // After file selection, Blooket may show a confirmation dialog with a button
  const confirmBtn = await findButton(page, [
    { selector: 'button:has-text("Import")', description: "button Import" },
    { selector: 'div[role="button"]:has-text("Import")', description: "div role=button Import" },
    { selector: 'button:has-text("Upload")', description: "button Upload" },
    { selector: 'button:has-text("Confirm")', description: "button Confirm" },
    { selector: 'div[class*="button"]:has-text("Import")', description: "div button class Import" },
  ], "Import/Upload confirmation");
  if (confirmBtn) {
    console.log('  Clicking import confirmation...');
    await confirmBtn.click();
    await page.waitForTimeout(3000);
  }

  // Dismiss any modal that appeared after import
  await dismissModals(page);

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

  // Force-remove any modal overlays blocking the save
  await dismissModals(page);

  // Try multiple strategies to find the save button
  // Real DOM: <div class="_button_552gk_1 _saveButton_1byfb_89" role="button">
  //   contains <div class="_saveButtonInside_1byfb_94">Save Set</div>
  const saveBtn = await findButton(page, [
    { selector: 'div[class*="saveButton"]:has-text("Save")', description: "div saveButton class" },
    { selector: 'div[role="button"]:has-text("Save Set")', description: "div role=button Save Set" },
    { selector: 'div[class*="saveButtonInside"]', description: "saveButtonInside class" },
    { selector: 'button:has-text("Save Set")', description: "button text" },
    { selector: '[class*="save" i]:has-text("Save")', description: "class+text save" },
  ], "Save Set");

  if (!saveBtn) {
    await dumpPageState(page);
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

function saveUploadRecord({ unit, lesson, title, url, csvPath }) {
  const uploads = existsSync(UPLOAD_LOG_PATH)
    ? JSON.parse(readFileSync(UPLOAD_LOG_PATH, "utf8"))
    : [];

  uploads.push({
    unit,
    lesson,
    title,
    url,
    csvPath,
    createdAt: new Date().toISOString(),
  });

  writeFileSync(UPLOAD_LOG_PATH, JSON.stringify(uploads, null, 2));
  console.log("Saved upload record to state/blooket-uploads.json");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  // Check if already uploaded
  if (opts.unit && opts.lesson) {
    const existing = getLesson(opts.unit, opts.lesson);
    if (existing?.urls?.blooket && existing?.status?.blooketUpload === "done") {
      console.log(`Blooket already uploaded for ${opts.unit}.${opts.lesson}: ${existing.urls.blooket}`);
      console.log("Use --force to re-upload.");
      if (!opts.force) {
        console.log(existing.urls.blooket); // Print URL for capture by lesson-prep
        return;
      }
    }
  }

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
  console.log(`  Force:    ${opts.force}`);

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

    if (opts.unit && opts.lesson) {
      // Write to lesson registry
      updateUrl(opts.unit, opts.lesson, "blooket", blooketUrl);
      updateStatus(opts.unit, opts.lesson, "blooketUpload", "done");
      console.log(`Registry: saved Blooket URL for ${opts.unit}.${opts.lesson}`);
    }

    try {
      saveUploadRecord({
        unit: opts.unit,
        lesson: opts.lesson,
        title: opts.title,
        url: blooketUrl,
        csvPath: opts.file,
      });
    } catch (err) {
      console.warn(`WARNING: Failed to save upload record: ${err.message}`);
    }
  } catch (err) {
    if (opts.unit && opts.lesson) {
      try {
        updateStatus(opts.unit, opts.lesson, "blooketUpload", "failed");
      } catch (statusErr) {
        console.warn(`WARNING: Failed to update registry status: ${statusErr.message}`);
      }
    }
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
