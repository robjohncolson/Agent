#!/usr/bin/env node
/**
 * index-drive-videos.mjs — Index Google Drive videos and match to AP Stats topics.
 *
 * Connects to an already-running browser via Chrome DevTools Protocol (CDP) so the
 * user's Google session is available. Navigates to a Google Drive folder, extracts
 * file metadata for all video files, and matches each video to an AP Statistics
 * topic number by filename pattern.
 *
 * Usage:
 *   # First run: provide the Drive folder URL
 *   node scripts/index-drive-videos.mjs --folder "https://drive.google.com/drive/folders/XXXXX"
 *
 *   # Subsequent runs: re-index (folder URL cached in config)
 *   node scripts/index-drive-videos.mjs --reindex
 *
 *   # Look up videos for a specific topic
 *   node scripts/index-drive-videos.mjs --lookup 6.5
 *
 *   # Dry run: show what would be indexed without saving
 *   node scripts/index-drive-videos.mjs --folder "https://drive.google.com/drive/folders/XXXXX" --dry-run
 *
 * Start Edge with remote debugging first:
 *   scripts/start-edge-debug.cmd
 *
 * Prerequisites:
 *   npm install playwright
 */

import fs from "node:fs";
import path from "node:path";

// Playwright is imported dynamically in main() so that arg parsing and --help
// work even if the package isn't installed yet.
let chromium;

// ── Constants ────────────────────────────────────────────────────────────────

import { CONFIG_DIR } from "./lib/paths.mjs";

const CDP_URL = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";
const INDEX_PATH = path.join(CONFIG_DIR, "drive-video-index.json");

// Video file extensions to match
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".wmv"];

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let folder = null;
  let reindex = false;
  let lookup = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--folder" || arg === "-f") {
      folder = args[++i];
    } else if (arg === "--reindex") {
      reindex = true;
    } else if (arg === "--lookup" || arg === "-l") {
      lookup = args[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  // Validate args
  if (!folder && !reindex && !lookup) {
    printUsage();
    process.exit(1);
  }

  return { folder, reindex, lookup, dryRun };
}

function printUsage() {
  console.log(
    "Usage: node scripts/index-drive-videos.mjs [options]\n\n" +
      "Options:\n" +
      "  -f, --folder <url>   Google Drive folder URL (saved for future runs)\n" +
      "  --reindex            Re-scan the folder (uses saved URL)\n" +
      "  -l, --lookup <topic> Look up videos for a topic number (e.g. 6.5)\n" +
      "  --dry-run            Show what would be indexed without saving\n" +
      "  -h, --help           Show this help\n\n" +
      "Examples:\n" +
      '  node scripts/index-drive-videos.mjs --folder "https://drive.google.com/drive/folders/XXXXX"\n' +
      "  node scripts/index-drive-videos.mjs --reindex\n" +
      "  node scripts/index-drive-videos.mjs --lookup 6.5\n"
  );
}

// ── Config / Index persistence ───────────────────────────────────────────────

function loadIndex() {
  try {
    if (fs.existsSync(INDEX_PATH)) {
      return JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
    }
  } catch (e) {
    console.log(`Warning: Could not read index file: ${e.message}`);
  }
  return null;
}

function saveIndex(index) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n", "utf-8");
  console.log(`\nIndex saved to: ${INDEX_PATH}`);
}

// ── Topic matching ───────────────────────────────────────────────────────────

/**
 * Try to extract an AP Stats topic number from a filename.
 *
 * Returns { topic: "6.5", videoNumber: 1 } or null if no match.
 *
 * Patterns matched (case-insensitive):
 *   "6.5"  "6-5"  "6_5"  "Topic 6.5"  "Topic_6-5"  "topic65"
 *   "Unit 6 Lesson 5"  "u6 l5"  "u6-l5"
 *   Video/Daily Video number: "Daily Video 1", "Video 2", "DV1", "DV 2", "#1"
 */
function matchTopic(filename) {
  const name = filename.replace(/\.[^.]+$/, ""); // strip extension
  const lower = name.toLowerCase();

  let topic = null;
  let videoNumber = null;

  // ── Strategy 1: Explicit topic patterns ────────────────────────────────
  // "Topic 6.5", "Topic_6-5", "Topic 6_5", "topic6.5"
  const topicExplicit = name.match(/topic[_\s-]*(\d{1,2})[.\-_](\d{1,2})/i);
  if (topicExplicit) {
    topic = `${topicExplicit[1]}.${topicExplicit[2]}`;
  }

  // ── Strategy 2: Dot-separated like "6.5" ──────────────────────────────
  if (!topic) {
    // Match "6.5" but avoid matching things like file size "45.2" by requiring
    // the unit number to be reasonable (1-12) and lesson (1-15)
    const dotSep = name.match(/\b(\d{1,2})\.(\d{1,2})\b/);
    if (dotSep) {
      const u = parseInt(dotSep[1], 10);
      const l = parseInt(dotSep[2], 10);
      if (u >= 1 && u <= 12 && l >= 1 && l <= 15) {
        topic = `${u}.${l}`;
      }
    }
  }

  // ── Strategy 3: Dash-separated like "6-5" ─────────────────────────────
  if (!topic) {
    // "6-5", but must look like a topic, not a date. Anchor to start or after space/underscore.
    const dashSep = name.match(/(?:^|[\s_])(\d{1,2})-(\d{1,2})(?:\s|_|-|$)/);
    if (dashSep) {
      const u = parseInt(dashSep[1], 10);
      const l = parseInt(dashSep[2], 10);
      if (u >= 1 && u <= 12 && l >= 1 && l <= 15) {
        topic = `${u}.${l}`;
      }
    }
  }

  // ── Strategy 4: Underscore-separated like "6_5" ───────────────────────
  if (!topic) {
    const underSep = name.match(/(?:^|[\s-])(\d{1,2})_(\d{1,2})(?:\s|_|-|$)/);
    if (underSep) {
      const u = parseInt(underSep[1], 10);
      const l = parseInt(underSep[2], 10);
      if (u >= 1 && u <= 12 && l >= 1 && l <= 15) {
        topic = `${u}.${l}`;
      }
    }
  }

  // ── Strategy 5: "Unit X Lesson Y" / "u6 l5" / "u6-l5" ────────────────
  if (!topic) {
    const unitLesson = name.match(/u(?:nit)?[_\s-]*(\d{1,2})[_\s-]*l(?:esson)?[_\s-]*(\d{1,2})/i);
    if (unitLesson) {
      topic = `${unitLesson[1]}.${unitLesson[2]}`;
    }
  }

  // ── Strategy 6: Concatenated like "topic65" ───────────────────────────
  if (!topic) {
    const concat = lower.match(/topic(\d)(\d{1,2})(?:\D|$)/);
    if (concat) {
      const u = parseInt(concat[1], 10);
      const l = parseInt(concat[2], 10);
      if (u >= 1 && u <= 9 && l >= 1 && l <= 15) {
        topic = `${u}.${l}`;
      }
    }
  }

  // ── Extract video number ───────────────────────────────────────────────
  // "Daily Video 1", "Video 2", "DV1", "DV 2", "#1", "v1", "vid 2"
  const vidNumPatterns = [
    /daily\s*video\s*(\d+)/i,
    /(?:^|[\s_-])dv\s*(\d+)/i,
    /video\s*(\d+)/i,
    /(?:^|[\s_-])v(\d+)(?:\D|$)/i,
    /(?:^|[\s_-])vid\s*(\d+)/i,
    /#(\d+)/,
    // Fallback: trailing number after topic-like prefix, e.g. "6-5 1" or "6.5 - 2"
    /\d[.\-_]\d{1,2}[\s_-]+(\d+)/,
  ];

  for (const pat of vidNumPatterns) {
    const m = name.match(pat);
    if (m) {
      videoNumber = parseInt(m[1], 10);
      break;
    }
  }

  if (!topic) return null;

  return {
    topic,
    videoNumber: videoNumber || 1,
  };
}

// ── CDP connection ───────────────────────────────────────────────────────────

async function connectViaCDP() {
  try {
    const response = await fetch(`${CDP_URL}/json/version`);
    if (response.ok) {
      const info = await response.json();
      console.log(`CDP: Found browser -- ${info.Browser || "unknown"}`);
      const browser = await chromium.connectOverCDP(CDP_URL);
      const contexts = browser.contexts();
      if (contexts.length === 0) {
        console.log("CDP: No browser contexts found.");
        return null;
      }
      const context = contexts[0];
      const pages = context.pages();
      // Prefer a tab already on Drive, otherwise use the first page
      let page = pages.find((p) => p.url().includes("drive.google.com")) || pages[0];
      if (!page) {
        page = await context.newPage();
      }
      console.log(`CDP: Connected. Using page: ${page.url()}`);
      return { browser, context, page };
    }
  } catch {
    // No debuggable browser running
  }
  return null;
}

// ── Drive scraping ───────────────────────────────────────────────────────────

/**
 * Navigate to a Google Drive folder and wait for the file list to load.
 */
async function navigateToDriveFolder(page, folderUrl) {
  console.log(`\nNavigating to Drive folder...`);
  console.log(`  URL: ${folderUrl}`);
  await page.goto(folderUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait for the file list to render. Drive uses multiple possible container selectors.
  console.log("  Waiting for file list to load...");
  const listSelectors = [
    '[data-id]',                              // Each file row has a data-id attribute
    'div[role="row"]',                        // Grid/list view rows
    'div[data-target="doc"]',                 // Doc target elements
    'div.WYuW0e',                             // Drive file items (class may vary)
    'div[role="gridcell"]',                   // Grid cells
    'c-wiz[data-p]',                          // Angular-wrapped elements
  ];

  let loaded = false;
  for (const sel of listSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 15_000 });
      const count = await page.$$eval(sel, (els) => els.length);
      if (count > 0) {
        console.log(`  File list loaded (${count} elements matched: ${sel})`);
        loaded = true;
        break;
      }
    } catch {
      // try next selector
    }
  }

  if (!loaded) {
    // Give extra time for slow loads
    console.log("  Primary selectors did not match. Waiting additional 10s...");
    await page.waitForTimeout(10_000);
  }

  // Extra wait for any lazy-loaded content
  await page.waitForTimeout(3000);
}

/**
 * Scroll the Drive file list to ensure all files are loaded (Drive lazy-loads).
 */
async function scrollToLoadAll(page) {
  console.log("  Scrolling to load all files...");

  let previousCount = 0;
  let stableRounds = 0;

  for (let i = 0; i < 30; i++) {
    // Count currently visible file elements
    const currentCount = await page.evaluate(() => {
      // Count items using multiple strategies
      const byDataId = document.querySelectorAll("[data-id]").length;
      const byRow = document.querySelectorAll('div[role="row"]').length;
      const byGridcell = document.querySelectorAll('div[role="gridcell"]').length;
      return Math.max(byDataId, byRow, byGridcell);
    }).catch(() => 0);

    if (currentCount === previousCount && currentCount > 0) {
      stableRounds++;
      if (stableRounds >= 3) {
        console.log(`  All files loaded (${currentCount} elements, stable after ${i + 1} scrolls).`);
        break;
      }
    } else {
      stableRounds = 0;
    }

    previousCount = currentCount;

    // Scroll the main content area down
    await page.evaluate(() => {
      // Try scrolling various containers that Drive uses
      const scrollTargets = [
        document.querySelector('[role="main"]'),
        document.querySelector('[class*="files-list"]'),
        document.querySelector('div[role="grid"]'),
        document.querySelector('div[role="list"]'),
        document.querySelector('.WYuW0e')?.closest('[style*="overflow"]'),
        document.documentElement,
      ];
      for (const el of scrollTargets) {
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }
      window.scrollTo(0, document.body.scrollHeight);
    }).catch(() => {});

    await page.waitForTimeout(1500);
  }
}

/**
 * Extract file metadata from the Google Drive file list.
 *
 * Returns an array of { fileId, filename, lastModified, size }.
 *
 * Google Drive's DOM varies (view mode, account type, etc.), so we try
 * multiple extraction strategies and merge results.
 */
async function extractFileMetadata(page) {
  console.log("\n  Extracting file metadata...");

  const files = await page.evaluate((videoExts) => {
    const results = [];
    const seenIds = new Set();

    // ── Helper: extract file ID from a URL ───────────────────────────────
    function extractFileId(href) {
      if (!href) return null;
      // /file/d/{ID}/  or  ?id={ID}  or  /d/{ID}
      const patterns = [
        /\/file\/d\/([a-zA-Z0-9_-]+)/,
        /\/d\/([a-zA-Z0-9_-]+)/,
        /[?&]id=([a-zA-Z0-9_-]+)/,
      ];
      for (const pat of patterns) {
        const m = href.match(pat);
        if (m) return m[1];
      }
      return null;
    }

    // ── Helper: check if filename looks like a video ─────────────────────
    function isVideoFile(name) {
      if (!name) return false;
      const lower = name.toLowerCase();
      return videoExts.some((ext) => lower.endsWith(ext));
    }

    // ── Strategy 1: Elements with data-id attribute ──────────────────────
    const dataIdEls = document.querySelectorAll("[data-id]");
    for (const el of dataIdEls) {
      const fileId = el.getAttribute("data-id");
      if (!fileId || fileId.length < 10 || seenIds.has(fileId)) continue;

      // Try to get the filename from the element or its children
      let filename = null;
      const textEl =
        el.querySelector('[data-tooltip]') ||
        el.querySelector('[aria-label]') ||
        el.querySelector('[class*="name"]') ||
        el.querySelector('div[class*="text"]') ||
        el;

      filename =
        textEl.getAttribute("data-tooltip") ||
        textEl.getAttribute("aria-label") ||
        textEl.textContent?.trim();

      // Clean up filename: take the first line if multi-line
      if (filename) {
        filename = filename.split("\n")[0].trim();
      }

      // Get last modified if visible
      let lastModified = null;
      const dateEl = el.querySelector('[data-column="modified"]') ||
        el.querySelector('[class*="modified"]') ||
        el.querySelector('[class*="date"]');
      if (dateEl) {
        lastModified = dateEl.textContent?.trim() || null;
      }

      // Get size if visible
      let size = null;
      const sizeEl = el.querySelector('[data-column="size"]') ||
        el.querySelector('[class*="size"]');
      if (sizeEl) {
        size = sizeEl.textContent?.trim() || null;
      }

      if (filename && isVideoFile(filename)) {
        seenIds.add(fileId);
        results.push({ fileId, filename, lastModified, size });
      }
    }

    // ── Strategy 2: Row elements with links containing file IDs ──────────
    const rows = document.querySelectorAll('div[role="row"], tr[role="row"], div[data-target="doc"]');
    for (const row of rows) {
      const links = row.querySelectorAll("a[href]");
      for (const link of links) {
        const fileId = extractFileId(link.href);
        if (!fileId || seenIds.has(fileId)) continue;

        const filename = link.textContent?.trim() || link.getAttribute("aria-label") || null;
        if (filename && isVideoFile(filename)) {
          // Get metadata from sibling cells
          let lastModified = null;
          let size = null;
          const cells = row.querySelectorAll('div[role="gridcell"], td');
          for (const cell of cells) {
            const text = cell.textContent?.trim();
            if (!text) continue;
            // Heuristic: date-like content
            if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text) ||
                /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(text)) {
              lastModified = text;
            }
            // Heuristic: size-like content
            if (/\b\d+(\.\d+)?\s*(KB|MB|GB|bytes)\b/i.test(text)) {
              size = text;
            }
          }

          seenIds.add(fileId);
          results.push({ fileId, filename: filename.split("\n")[0].trim(), lastModified, size });
        }
      }
    }

    // ── Strategy 3: Aria labels on file items ────────────────────────────
    const ariaEls = document.querySelectorAll("[aria-label]");
    for (const el of ariaEls) {
      const label = el.getAttribute("aria-label") || "";
      if (!isVideoFile(label)) continue;

      // Try to find a file ID from the element or its parent
      let fileId = el.closest("[data-id]")?.getAttribute("data-id") || null;
      if (!fileId) {
        const link = el.querySelector("a[href]") || el.closest("a[href]");
        if (link) fileId = extractFileId(link.href);
      }
      if (!fileId || seenIds.has(fileId)) continue;

      seenIds.add(fileId);
      results.push({
        fileId,
        filename: label.split("\n")[0].trim(),
        lastModified: null,
        size: null,
      });
    }

    // ── Strategy 4: All links on the page with file IDs in href ──────────
    // Broad fallback: scan every <a> on the page
    const allLinks = document.querySelectorAll("a[href*='/file/d/'], a[href*='/d/']");
    for (const link of allLinks) {
      const fileId = extractFileId(link.href);
      if (!fileId || seenIds.has(fileId)) continue;

      const filename =
        link.textContent?.trim() ||
        link.getAttribute("aria-label") ||
        link.getAttribute("data-tooltip") ||
        null;

      if (filename && isVideoFile(filename)) {
        seenIds.add(fileId);
        results.push({
          fileId,
          filename: filename.split("\n")[0].trim(),
          lastModified: null,
          size: null,
        });
      }
    }

    return results;
  }, VIDEO_EXTENSIONS);

  console.log(`  Found ${files.length} video file(s).`);
  return files;
}

// ── Lookup mode ──────────────────────────────────────────────────────────────

function lookupTopic(topicQuery) {
  const index = loadIndex();
  if (!index) {
    console.error("No index found. Run with --folder or --reindex first.");
    process.exit(1);
  }

  // Normalize the query: "6.5" or "6-5" or "6_5" -> "6.5"
  const normalized = topicQuery.replace(/[-_]/, ".");

  const matches = index.videos.filter((v) => v.topic === normalized);

  if (matches.length === 0) {
    console.log(`\nNo videos found for topic ${normalized}.`);
    console.log("\nAvailable topics:");
    const topics = [...new Set(index.videos.filter((v) => v.topic).map((v) => v.topic))].sort(
      (a, b) => {
        const [au, al] = a.split(".").map(Number);
        const [bu, bl] = b.split(".").map(Number);
        return au - bu || al - bl;
      }
    );
    for (const t of topics) {
      const count = index.videos.filter((v) => v.topic === t).length;
      console.log(`  ${t} (${count} video${count !== 1 ? "s" : ""})`);
    }
    return;
  }

  // Sort by video number
  matches.sort((a, b) => (a.video_number || 0) - (b.video_number || 0));

  console.log(`\nTopic ${normalized} videos:`);
  for (const v of matches) {
    const num = v.video_number || "?";
    console.log(`  Video ${num}: ${v.file_id} (${v.filename})`);
  }

  // Also print a ready-to-use command
  const ids = matches.map((v) => v.file_id).join('" "');
  console.log(`\nReady-to-use command:`);
  const [unit, lesson] = normalized.split(".");
  console.log(`  node scripts/aistudio-ingest.mjs --unit ${unit} --lesson ${lesson} --drive-ids "${ids}"`);
}

// ── Main workflow ────────────────────────────────────────────────────────────

async function indexFolder(folderUrl, dryRun) {
  // Dynamic import so arg parsing works even without playwright installed
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.error("Error: 'playwright' package not found.");
    console.error("Install it with:  npm install playwright");
    process.exit(1);
  }

  console.log("\nGoogle Drive Video Indexer");
  console.log("=".repeat(40));
  console.log(`  Folder: ${folderUrl}`);
  console.log(`  Dry run: ${dryRun}`);

  // ── Connect to the browser via CDP ──────────────────────────────────────
  console.log(`\nConnecting to browser via CDP at ${CDP_URL}...`);
  const cdpResult = await connectViaCDP();

  if (!cdpResult) {
    console.error("\nNo browser with remote debugging found.");
    console.error("Start Edge with debugging enabled:\n");
    console.error(
      '  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --remote-debugging-port=9222\n'
    );
    console.error("Or run the helper script:\n");
    console.error("  scripts\\start-edge-debug.cmd\n");
    console.error(
      "Make sure you are logged in to Google Drive, then run this script again."
    );
    process.exit(1);
  }

  const { browser, page } = cdpResult;

  try {
    // ── Step 1: Navigate to the Drive folder ──────────────────────────────
    await navigateToDriveFolder(page, folderUrl);

    // ── Step 2: Scroll to load all files ──────────────────────────────────
    await scrollToLoadAll(page);

    // ── Step 3: Extract file metadata ─────────────────────────────────────
    const rawFiles = await extractFileMetadata(page);

    if (rawFiles.length === 0) {
      console.log("\nNo video files found in this folder.");
      console.log("Make sure the folder contains video files (.mp4, .webm, .mov, etc.).");
      console.log("The Drive file list may not have fully loaded. Try running again.");
      return;
    }

    // ── Step 4: Match topics by filename ──────────────────────────────────
    console.log("\n  Matching topics by filename...");
    const videos = [];
    let matched = 0;
    let unmatched = 0;

    for (const file of rawFiles) {
      const match = matchTopic(file.filename);

      const entry = {
        file_id: file.fileId,
        filename: file.filename,
        topic: match ? match.topic : null,
        video_number: match ? match.videoNumber : null,
        identified_by: match ? "filename_pattern" : "unidentified",
        last_modified: file.lastModified || null,
        size: file.size || null,
      };

      videos.push(entry);

      if (match) {
        matched++;
        console.log(`    [matched]  ${file.filename} -> Topic ${match.topic}, Video ${match.videoNumber}`);
      } else {
        unmatched++;
        console.log(`    [unknown]  ${file.filename}`);
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────
    console.log(`\n${"=".repeat(50)}`);
    console.log(`  Total videos:  ${videos.length}`);
    console.log(`  Matched:       ${matched}`);
    console.log(`  Unidentified:  ${unmatched}`);
    console.log("=".repeat(50));

    // List unique topics found
    const topics = [...new Set(videos.filter((v) => v.topic).map((v) => v.topic))].sort(
      (a, b) => {
        const [au, al] = a.split(".").map(Number);
        const [bu, bl] = b.split(".").map(Number);
        return au - bu || al - bl;
      }
    );
    if (topics.length > 0) {
      console.log("\n  Topics found:");
      for (const t of topics) {
        const count = videos.filter((v) => v.topic === t).length;
        console.log(`    ${t} (${count} video${count !== 1 ? "s" : ""})`);
      }
    }

    if (unmatched > 0) {
      console.log(
        `\n  ${unmatched} video(s) could not be matched to a topic by filename.`
      );
      console.log(
        "  You can manually assign topics by editing the index file,\n" +
          "  or a future version can use Gemini for identification."
      );
    }

    // ── Step 5: Save the index ────────────────────────────────────────────
    if (dryRun) {
      console.log("\n[DRY RUN] Index would be saved to:");
      console.log(`  ${INDEX_PATH}`);
      console.log("\n[DRY RUN] Sample entry:");
      console.log(JSON.stringify(videos[0], null, 2));
    } else {
      // Load existing index to preserve manually-set topic assignments
      const existing = loadIndex();
      const existingMap = new Map();
      if (existing?.videos) {
        for (const v of existing.videos) {
          existingMap.set(v.file_id, v);
        }
      }

      // Merge: keep manual assignments from existing index for files that
      // are still present, but update metadata from the fresh scrape
      const mergedVideos = videos.map((v) => {
        const prev = existingMap.get(v.file_id);
        if (prev && prev.identified_by === "manual" && v.identified_by === "unidentified") {
          // Preserve manual topic assignment
          return {
            ...v,
            topic: prev.topic,
            video_number: prev.video_number,
            identified_by: "manual",
          };
        }
        if (prev && prev.identified_by === "gemini_analysis" && v.identified_by === "unidentified") {
          // Preserve Gemini-identified topics
          return {
            ...v,
            topic: prev.topic,
            video_number: prev.video_number,
            identified_by: "gemini_analysis",
          };
        }
        return v;
      });

      const index = {
        drive_folder_url: folderUrl,
        last_indexed: new Date().toISOString(),
        videos: mergedVideos,
      };

      saveIndex(index);
    }
  } catch (err) {
    console.error(`\nError during indexing: ${err.message}`);
    console.error(err.stack);
  } finally {
    // Disconnect without closing the user's browser
    console.log("\nDisconnecting from browser (CDP). Your browser remains open.");
    if (browser) {
      await browser.close(); // close() on a CDP browser just disconnects
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv);

  // ── Lookup mode ─────────────────────────────────────────────────────────
  if (opts.lookup) {
    lookupTopic(opts.lookup);
    return;
  }

  // ── Determine folder URL ────────────────────────────────────────────────
  let folderUrl = opts.folder;

  if (opts.reindex) {
    const existing = loadIndex();
    if (existing?.drive_folder_url) {
      folderUrl = existing.drive_folder_url;
      console.log(`Using saved folder URL: ${folderUrl}`);
    } else {
      console.error("No saved folder URL found. Use --folder to specify one.");
      process.exit(1);
    }
  }

  if (!folderUrl) {
    console.error("No folder URL provided. Use --folder <url> or --reindex.");
    process.exit(1);
  }

  // Validate it looks like a Drive folder URL
  if (!folderUrl.includes("drive.google.com")) {
    console.error("Error: URL does not look like a Google Drive folder.");
    console.error("Expected: https://drive.google.com/drive/folders/XXXXX");
    process.exit(1);
  }

  await indexFolder(folderUrl, opts.dryRun);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
