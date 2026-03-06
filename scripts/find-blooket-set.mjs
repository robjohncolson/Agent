#!/usr/bin/env node
/**
 * find-blooket-set.mjs - Search the Blooket "My Sets" page for set titles.
 *
 * Usage:
 *   node scripts/find-blooket-set.mjs <keyword>
 *   node scripts/find-blooket-set.mjs --json <keyword>
 */

import { connectCDP } from "./lib/cdp-connect.mjs";
import { dismissCookieBanner, scrollToLoadAll } from "./lib/blooket-helpers.mjs";

function printUsage() {
  console.log(
    "Usage: node scripts/find-blooket-set.mjs [--json] <keyword>\n\n" +
      "Examples:\n" +
      '  node scripts/find-blooket-set.mjs "AP Stats"\n' +
      '  node scripts/find-blooket-set.mjs --json "AP Stats"\n'
  );
}

function parseArgs(argv) {
  let jsonMode = false;
  let keyword = argv[2];

  if (keyword === "--help" || keyword === "-h") {
    printUsage();
    process.exit(0);
  }

  if (keyword === "--json") {
    jsonMode = true;
    keyword = argv[3];
  }

  if (!keyword || !keyword.trim()) {
    printUsage();
    process.exit(1);
  }

  return { jsonMode, keyword: keyword.trim() };
}

function log(jsonMode, ...args) {
  if (!jsonMode) {
    console.log(...args);
  }
}

async function connectToBrowser(chromium, jsonMode) {
  if (!jsonMode) {
    return connectCDP(chromium, { preferUrl: "blooket" });
  }

  const originalLog = console.log;
  console.log = (...args) => console.error(...args);

  try {
    return await connectCDP(chromium, { preferUrl: "blooket" });
  } finally {
    console.log = originalLog;
  }
}

async function loadMySetsPage(page) {
  await page.goto("https://dashboard.blooket.com/my-sets", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(2000);

  if (/\/login\b/i.test(page.url())) {
    throw new Error(
      "Blooket login required. Sign in at dashboard.blooket.com in the CDP browser and try again."
    );
  }

  await dismissCookieBanner(page);

  await page
    .waitForFunction(
      () =>
        Boolean(document.querySelector('[class*="_setContainer"]')) ||
        /no sets/i.test(document.body.innerText),
      { timeout: 15000 }
    )
    .catch(() => {});

  await scrollToLoadAll(page);
  await page.waitForTimeout(500);
}

async function collectSets(page) {
  return page.evaluate(() => {
    const METADATA_PATTERNS = [
      /^Blooket$/i,
      /^\d+\s+Questions?$/i,
      /^\d+\s+Plays$/i,
      /^Edited\b/i,
      /^(Assign|Host|Solo|Print|Move|Copy|Merge|Link)$/i,
    ];

    function isMetadataLine(line) {
      return METADATA_PATTERNS.some((pattern) => pattern.test(line));
    }

    function cleanText(node) {
      if (!node) {
        return "";
      }

      const clone = node.cloneNode(true);
      clone.querySelectorAll("style, script").forEach((element) => element.remove());
      return (clone.textContent || "").replace(/\s+/g, " ").trim();
    }

    function extractTitle(card) {
      const titleNode = card.querySelector('[class*="_setHeader"]');
      const explicitTitle = cleanText(titleNode);
      if (explicitTitle) {
        return explicitTitle;
      }

      const lines = (card.innerText || "")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);

      return lines.find((line) => !isMetadataLine(line)) || "";
    }

    function extractQuestionCount(card) {
      const questionText = cleanText(card.querySelector('[class*="_setQuestionsText"]'));
      const match = questionText.match(/(\d+)/);
      return match ? Number.parseInt(match[1], 10) : null;
    }

    return Array.from(document.querySelectorAll('[class*="_setContainer"]'))
      .map((card) => {
        const link = card.querySelector('a[href^="/set/"], a[href*="/set/"]');
        const href = link?.getAttribute("href");

        if (!href) {
          return null;
        }

        const url = new URL(href, window.location.origin).toString();
        const match = url.match(/\/set\/([^/?#]+)/);
        const id = match ? match[1] : "";

        return {
          id,
          title: extractTitle(card),
          questionCount: extractQuestionCount(card),
          url,
        };
      })
      .filter((item) => item && item.id);
  });
}

function filterSetsByKeyword(sets, keyword) {
  const needle = keyword.toLowerCase();
  return sets.filter((set) => (set.title || "").toLowerCase().includes(needle));
}

function printHumanResults(keyword, sets) {
  if (sets.length === 0) {
    console.log(`No Blooket sets found for "${keyword}".`);
    return;
  }

  console.log(`Found ${sets.length} Blooket set(s) for "${keyword}":`);

  for (const set of sets) {
    const questionLabel =
      typeof set.questionCount === "number"
        ? `${set.questionCount} question${set.questionCount === 1 ? "" : "s"}`
        : "question count unavailable";

    console.log(`- ${set.title} (${questionLabel})`);
    console.log(`  ${set.url}`);
  }
}

async function main() {
  const { jsonMode, keyword } = parseArgs(process.argv);

  let chromium;
  let page;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Error: 'playwright' package not found.");
    console.error("Install it with: npm install playwright");
    process.exit(1);
  }

  let browser;

  try {
    log(jsonMode, `Searching Blooket for "${keyword}"...`);
    ({ browser, page } = await connectToBrowser(chromium, jsonMode));

    await loadMySetsPage(page);

    const allSets = await collectSets(page);
    const matches = filterSetsByKeyword(allSets, keyword);

    if (jsonMode) {
      console.log(JSON.stringify(matches, null, 2));
    } else {
      printHumanResults(keyword, matches);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
