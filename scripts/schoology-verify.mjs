#!/usr/bin/env node
/**
 * schoology-verify.mjs — Verify lesson links exist in both Period B and Period E Schoology folders.
 *
 * Usage:
 *   node scripts/schoology-verify.mjs --unit 6 --lesson 11
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";
import { navigateToFolder, listItems, COURSE_IDS } from "./lib/schoology-dom.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const REGISTRY_PATH = resolve(REPO_ROOT, "state", "lesson-registry.json");

const LINK_TYPES = [
  { key: "worksheet", title: "Live Worksheet" },
  { key: "drills",    title: "Drills" },
  { key: "quiz",      title: "Quiz" },
  { key: "blooket",   title: "Blooket" },
];

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let unit = null;
  let lesson = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--unit" && args[i + 1]) unit = args[++i];
    else if (args[i] === "--lesson" && args[i + 1]) lesson = args[++i];
  }
  if (!unit || !lesson) {
    console.error("Usage: node scripts/schoology-verify.mjs --unit <U> --lesson <L>");
    process.exit(1);
  }
  return { unit, lesson };
}

// ── Folder ID extraction ──────────────────────────────────────────────────────

function extractFolderId(folderUrl) {
  try {
    const u = new URL(folderUrl);
    return u.searchParams.get("f");
  } catch {
    return null;
  }
}

function extractCourseId(folderUrl) {
  try {
    const u = new URL(folderUrl);
    // URL pattern: /course/{courseId}/materials
    const match = u.pathname.match(/\/course\/(\d+)\/materials/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── Verification logic ────────────────────────────────────────────────────────

/**
 * Verify links in a single folder.
 * Returns array of { title, found } for each expected link type.
 */
async function verifyFolder(page, courseId, folderId, expectedLinks) {
  await navigateToFolder(page, courseId, folderId);
  const items = await listItems(page);
  const itemNames = new Set(items.map(i => i.name));

  return expectedLinks.map(({ title }) => ({
    title,
    found: itemNames.has(title),
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { unit, lesson } = parseArgs();
  const key = `${unit}.${lesson}`;

  // Load registry
  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch (err) {
    console.error(`Failed to read registry at ${REGISTRY_PATH}: ${err.message}`);
    process.exit(1);
  }

  const entry = registry[key];
  if (!entry) {
    console.error(`No registry entry found for lesson ${key}`);
    process.exit(1);
  }

  const urls = entry.urls || {};

  // Determine which link types are expected (non-null URLs in registry)
  const expectedLinks = LINK_TYPES
    .filter(lt => urls[lt.key])
    .map(lt => ({ key: lt.key, title: `${lt.title} \u2014 ${unit}.${lesson}` }));

  console.log(`Verifying Schoology links for ${key}`);
  console.log("");

  // Periods to check: B and E
  const periods = [
    { label: "Period B", urlKey: "schoologyFolder",  courseIdKey: "B" },
    { label: "Period E", urlKey: "schoologyFolderE", courseIdKey: "E" },
  ];

  // Connect CDP once
  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology" });

  let totalExpected = 0;
  let totalFound = 0;
  let anyMissing = false;

  for (const period of periods) {
    const folderUrl = urls[period.urlKey];

    if (!folderUrl) {
      console.log(`${period.label}: no folder URL — skipping`);
      console.log("");
      continue;
    }

    const folderId = extractFolderId(folderUrl);
    const courseId = extractCourseId(folderUrl) || COURSE_IDS[period.courseIdKey];

    if (!folderId) {
      console.log(`${period.label}: could not extract folder ID from URL — skipping`);
      console.log("");
      continue;
    }

    console.log(`${period.label} (folder ${folderId}):`);

    const results = await verifyFolder(page, courseId, folderId, expectedLinks);

    for (const { title, found } of results) {
      totalExpected++;
      if (found) {
        totalFound++;
        console.log(`  OK  ${title}`);
      } else {
        anyMissing = true;
        console.log(`  MISSING  ${title}`);
      }
    }

    console.log("");
  }

  // Disconnect CDP (browser stays open)
  await browser.close();

  // Summary
  const missing = totalExpected - totalFound;
  console.log(`Summary: ${totalFound}/${totalExpected} links verified, ${missing} missing`);

  process.exit(anyMissing ? 1 : 0);
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
