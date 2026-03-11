#!/usr/bin/env node
/**
 * scrape-schoology-urls.mjs
 *
 * Scrape Schoology materials folders and backfill lesson URLs into state/lesson-registry.json.
 *
 * Usage:
 *   node scripts/scrape-schoology-urls.mjs [--dry-run] [--course-url <url>]
 */

import { chromium } from "playwright";
import {
  upsertLesson,
  updateUrl,
  updateStatus,
  loadRegistry,
  saveRegistry,
} from "./lib/lesson-registry.mjs";
import { COURSE_IDS } from "./lib/schoology-dom.mjs";

const CDP_ENDPOINT = "http://localhost:9222";
const DEFAULT_COURSE_URL =
  "https://lynnschools.schoology.com/course/7810966498/materials";
const NAV_TIMEOUT_MS = 30_000;
const NAV_DELAY_MS = 1_500;
const TOPIC_REGEX = /(?:Topic\s+)?(\d+)\.(\d+)/i;

function printUsage(exitCode = 0) {
  console.log(
    "Usage: node scripts/scrape-schoology-urls.mjs [--dry-run] [--course-url <url>]\n\n" +
      "Options:\n" +
      "  --dry-run           Print updates without writing registry changes\n" +
      `  --course-url <url>  Materials URL (default: ${DEFAULT_COURSE_URL})\n`
  );
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let dryRun = false;
  let courseUrl = DEFAULT_COURSE_URL;
  let coursePeriod = 'B';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--course-url") {
      const next = args[i + 1];
      if (!next) {
        console.error("Missing value for --course-url.");
        printUsage(1);
      }
      courseUrl = next;
      i += 1;
      continue;
    }

    if (arg === "--course") {
      const next = args[i + 1];
      if (!next) {
        console.error("Missing value for --course.");
        printUsage(1);
      }
      coursePeriod = next;
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage(0);
    }

    console.error(`Unknown argument: ${arg}`);
    printUsage(1);
  }

  try {
    // Validate URL shape early.
    // eslint-disable-next-line no-new
    new URL(courseUrl);
  } catch {
    console.error(`Invalid --course-url: ${courseUrl}`);
    process.exit(1);
  }

  return { dryRun, courseUrl, coursePeriod };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMaterialsRootUrl(inputUrl) {
  const parsed = new URL(inputUrl);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

async function assertLoggedIn(page) {
  const currentUrl = page.url().toLowerCase();
  if (currentUrl.includes("/login")) {
    throw new Error("Schoology login required (redirected to /login).");
  }

  const hasLoginForm = await page.evaluate(() => {
    const form = document.querySelector(
      'form[action*="/login"], form#login-form, form#s-user-login-form'
    );
    const hasEmail = Boolean(
      document.querySelector('input[name="mail"], input[name="username"], input[type="email"]')
    );
    const hasPassword = Boolean(
      document.querySelector('input[name="pass"], input[type="password"]')
    );
    return Boolean(form) || (hasEmail && hasPassword);
  });

  if (hasLoginForm) {
    throw new Error("Schoology login form detected. Log in and re-run.");
  }
}

function inferUrlType(title) {
  const lower = title.toLowerCase();

  if (lower.includes("worksheet") || lower.includes("follow-along")) {
    return "worksheet";
  }
  if (lower.includes("drill")) {
    return "drills";
  }
  if (lower.includes("quiz")) {
    return "quiz";
  }
  if (lower.includes("blooket")) {
    return "blooket";
  }

  return null;
}

function parseUnitLesson(title) {
  const match = title.match(TOPIC_REGEX);
  if (!match) return null;

  const unit = Number.parseInt(match[1], 10);
  const lesson = Number.parseInt(match[2], 10);

  if (!Number.isInteger(unit) || !Number.isInteger(lesson)) {
    return null;
  }

  return { unit, lesson };
}

function statusKeysForUrlType(urlType) {
  if (urlType === "worksheet") return ["worksheet"];
  if (urlType === "drills") return ["drills"];
  if (urlType === "quiz") return ["worksheet"];
  if (urlType === "blooket") return ["blooketCsv", "blooketUpload"];
  return [];
}

function unwrapSchoologyLink(rawUrl) {
  if (!rawUrl) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    const wrappedKeys = ["url", "target", "u", "link"];

    for (const key of wrappedKeys) {
      const value = parsed.searchParams.get(key);
      if (!value) continue;

      let decoded = value;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        // Keep original parameter value if decode fails.
      }

      if (/^https?:\/\//i.test(decoded)) {
        return decoded;
      }
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

async function collectFolders(page, materialsRootUrl) {
  return page.evaluate((rootUrl) => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const entries = [];

    const resolveHref = (href) => {
      if (!href) return null;
      try {
        return new URL(href, window.location.href).toString();
      } catch {
        return null;
      }
    };

    const buildFolderUrl = (folderId, href) => {
      if (folderId) {
        try {
          const parsed = new URL(rootUrl, window.location.href);
          parsed.searchParams.set("f", folderId);
          return parsed.toString();
        } catch {
          // Fall back to resolved href.
        }
      }
      return href;
    };

    const addEntry = ({ folderId, title, href }) => {
      const normalizedTitle = clean(title);
      if (!normalizedTitle) return;

      const normalizedHref = resolveHref(href);
      let normalizedFolderId = folderId || null;

      if (!normalizedFolderId && normalizedHref) {
        try {
          normalizedFolderId = new URL(normalizedHref).searchParams.get("f");
        } catch {
          normalizedFolderId = null;
        }
      }

      const folderUrl = buildFolderUrl(normalizedFolderId, normalizedHref);
      if (!folderUrl) return;

      entries.push({
        folderId: normalizedFolderId,
        title: normalizedTitle,
        folderUrl,
      });
    };

    for (const row of document.querySelectorAll('tr[id^="f-"]')) {
      const rowId = row.getAttribute("id") || "";
      const match = rowId.match(/^f-(\d+)/);
      const rowFolderId = match ? match[1] : null;
      const titleLink = row.querySelector("div.folder-title a, td.item-title a, a[href*='f=']");
      const titleNode = row.querySelector("div.folder-title, td.item-title");

      addEntry({
        folderId: rowFolderId,
        title: titleLink?.textContent || titleNode?.textContent || "",
        href: titleLink?.getAttribute("href") || null,
      });
    }

    // Fallback in case row-based selectors change.
    for (const link of document.querySelectorAll('a[href*="f="]')) {
      addEntry({
        folderId: null,
        title: link.textContent || "",
        href: link.getAttribute("href"),
      });
    }

    const deduped = [];
    const seen = new Set();
    for (const entry of entries) {
      const key = entry.folderId
        ? `id:${entry.folderId}`
        : `title:${entry.title.toLowerCase()}|${entry.folderUrl}`;

      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(entry);
    }

    return deduped;
  }, materialsRootUrl);
}

async function collectFolderLinks(page) {
  return page.evaluate(() => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const output = [];
    const seen = new Set();

    // Restrict to material rows to avoid nav/sidebar noise.
    const rows = document.querySelectorAll(
      'tr[id^="s-"], tr.material-row, .material-row'
    );

    for (const row of rows) {
      const anchors = row.querySelectorAll("a[href]");
      for (const anchor of anchors) {
        const href = anchor.href || anchor.getAttribute("href") || "";
        if (!href || href.startsWith("javascript:") || href === "#") {
          continue;
        }

        const title = clean(
          anchor.textContent ||
            anchor.getAttribute("title") ||
            row.querySelector(".item-title")?.textContent ||
            ""
        );

        if (!title) continue;

        const key = `${title}|${href}`;
        if (seen.has(key)) continue;
        seen.add(key);

        output.push({ title, url: href });
      }
    }

    return output;
  });
}

function applyRegistryUpdate({
  dryRun,
  unit,
  lesson,
  folderTitle,
  folderUrl,
  urlType,
  lessonUrl,
  coursePeriod = 'B',
}) {
  const lessonKey = `${unit}.${lesson}`;
  const statusKeys = statusKeysForUrlType(urlType);
  const folderUrlKey = coursePeriod === 'E' ? 'schoologyFolderE' : 'schoologyFolder';

  if (dryRun) {
    console.log(`    [dry-run] ${lessonKey} urls.${urlType} = ${lessonUrl}`);
    if (folderUrl) {
      console.log(`    [dry-run] ${lessonKey} urls.${folderUrlKey} = ${folderUrl}`);
    }
    for (const statusKey of statusKeys) {
      console.log(`    [dry-run] ${lessonKey} status.${statusKey} = scraped`);
    }
    if (folderUrl) {
      console.log(`    [dry-run] ${lessonKey} status.schoology = scraped`);
    }
    return;
  }

  upsertLesson(unit, lesson, { topic: folderTitle });
  updateUrl(unit, lesson, urlType, lessonUrl);
  if (folderUrl) {
    updateUrl(unit, lesson, folderUrlKey, folderUrl);
  }

  for (const statusKey of statusKeys) {
    updateStatus(unit, lesson, statusKey, "scraped");
  }
  if (folderUrl) {
    updateStatus(unit, lesson, "schoology", "scraped");
  }
}

async function connectToEdgeCdp() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  } catch (error) {
    throw new Error(
      "Failed to connect to Edge CDP at http://localhost:9222.\n" +
        "Start Edge with remote debugging first:\n" +
        '  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --remote-debugging-port=9222\n' +
        "Or run:\n" +
        "  scripts\\start-edge-debug.cmd\n" +
        `Original error: ${error.message}`
    );
  }

  const contexts = browser.contexts();
  if (contexts.length === 0) {
    await browser.close().catch(() => {});
    throw new Error("CDP connected, but no browser contexts were found.");
  }

  const context = contexts[0];
  let page = context.pages().find((candidate) =>
    candidate.url().includes("schoology.com")
  );
  if (!page) {
    page = await context.newPage();
  }

  return { browser, page };
}

async function main() {
  const opts = parseArgs(process.argv);
  const courseId = COURSE_IDS[opts.coursePeriod] || COURSE_IDS.B;
  const defaultUrl = `https://lynnschools.schoology.com/course/${courseId}/materials`;
  const materialsRootUrl = opts.courseUrl !== DEFAULT_COURSE_URL
    ? toMaterialsRootUrl(opts.courseUrl)
    : defaultUrl;
  const registryBefore = loadRegistry();
  const beforeCount = Object.keys(registryBefore).length;

  console.log(`Scraping Schoology materials from Period ${opts.coursePeriod}...`);
  console.log(`Course URL: ${materialsRootUrl}`);
  if (opts.dryRun) {
    console.log("Mode: dry-run (no writes)");
  }

  const { browser, page } = await connectToEdgeCdp();

  try {
    await page.goto(materialsRootUrl, {
      waitUntil: "networkidle",
      timeout: NAV_TIMEOUT_MS,
    });
    await assertLoggedIn(page);

    const folders = await collectFolders(page, materialsRootUrl);
    if (folders.length === 0) {
      console.log("No folder rows were found on the materials page.");
      return;
    }

    let foundLinkCount = 0;
    let foldersWithParseableLinks = 0;
    const updatedLessons = new Set();

    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];

      try {
        await page.goto(folder.folderUrl, {
          waitUntil: "networkidle",
          timeout: NAV_TIMEOUT_MS,
        });
        await assertLoggedIn(page);

        const links = await collectFolderLinks(page);
        if (links.length === 0) {
          // Empty folder: skip silently.
        } else {
          const parseable = [];

          for (const link of links) {
            const parsed = parseUnitLesson(link.title);
            const urlType = inferUrlType(link.title);
            if (!parsed || !urlType) continue;

            parseable.push({
              ...parsed,
              title: link.title,
              urlType,
              url: unwrapSchoologyLink(link.url),
            });
          }

          if (parseable.length > 0) {
            foldersWithParseableLinks += 1;
            console.log(`\nFolder: ${folder.title}`);

            for (const item of parseable) {
              foundLinkCount += 1;
              updatedLessons.add(`${item.unit}.${item.lesson}`);

              console.log(`  ${item.title} -> ${item.urlType}`);
              applyRegistryUpdate({
                dryRun: opts.dryRun,
                unit: item.unit,
                lesson: item.lesson,
                folderTitle: folder.title,
                folderUrl: folder.folderUrl,
                urlType: item.urlType,
                lessonUrl: item.url,
                coursePeriod: opts.coursePeriod,
              });
            }
          }
        }
      } catch (error) {
        console.warn(`Skipping folder "${folder.title}": ${error.message}`);
      }

      // Reset to root view between folders to match Schoology navigation behavior.
      await page.goto(materialsRootUrl, {
        waitUntil: "networkidle",
        timeout: NAV_TIMEOUT_MS,
      }).catch(() => {});

      if (i < folders.length - 1) {
        await sleep(NAV_DELAY_MS);
      }
    }

    if (!opts.dryRun) {
      // Keep formatting stable after multiple incremental updates.
      saveRegistry(loadRegistry());
    }

    const afterCount = opts.dryRun ? beforeCount : Object.keys(loadRegistry()).length;
    const updatedLabel = opts.dryRun ? "Would update" : "Updated";

    console.log(
      `\nSummary: Found ${foundLinkCount} links across ${foldersWithParseableLinks} folders. ` +
        `${updatedLabel} ${updatedLessons.size} registry entries.`
    );
    if (!opts.dryRun) {
      console.log(`Registry entries: ${beforeCount} -> ${afterCount}`);
    }
  } finally {
    // CDP close disconnects; it does not close the Edge window itself.
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
